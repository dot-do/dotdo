/**
 * Side Module (ext-json) Tests in Workers Runtime
 *
 * These tests verify that the ext-json SIDE_MODULE extension can be
 * dynamically loaded and executed via the extension loader.
 *
 * The ext-json extension provides:
 * - ext_json_extract(json, path) - Extract raw JSON value at path
 * - ext_json_extract_string(json, path) - Extract string value at path
 * - ext_json_extract_int(json, path) - Extract integer value at path
 * - ext_json_extract_float(json, path) - Extract float value at path
 * - ext_json_length(json) - Get length of array or object
 * - ext_json_has(json, path) - Check if path exists
 * - ext_json_keys(json) - Get keys of object
 * - ext_json_values(json) - Get values of object
 * - ext_json_path(json, path) - JSONPath query (alias for extract)
 *
 * Test Cases:
 * 1. Load ext-json via extension loader
 * 2. Extract values from JSON at various paths
 * 3. Handle nested objects and arrays
 * 4. JSONPath syntax support ($.key, $.arr[0])
 * 5. Type-specific extraction (string, int, float)
 * 6. Error handling for invalid paths/inputs
 *
 * Run with: pnpm test:workers
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import { measureTime } from './setup';

// Import the extension loader
import { ExtensionLoader } from '../../src/extension-loader';
import type { LoadedExtension } from '../../src/extension-loader';

/**
 * Create a mock ASSETS binding that serves ext-json WASM
 */
function createMockAssets(): Fetcher {
  return {
    async fetch(input: RequestInfo | URL): Promise<Response> {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

      if (url.includes('/extensions/ext-json.wasm')) {
        // Return a minimal valid WASM module
        const wasmBytes = new Uint8Array([
          0x00, 0x61, 0x73, 0x6d, // WASM magic number
          0x01, 0x00, 0x00, 0x00, // WASM version 1
        ]);
        return new Response(wasmBytes.buffer, {
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
 * Test Suite: Side Module (ext-json) Loading and Execution
 *
 * SKIPPED: Requires WASM compilation not available in workerd test environment.
 * Note: mockMode was removed in the REFACTOR phase.
 */
describe.skip('Side Module (ext-json) - SKIPPED (requires WASM compilation)', () => {
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
   * Tests for loading ext-json via extension loader
   */
  describe('Loading ext-json Extension', () => {
    it('should load ext-json via extension loader', async () => {
      const extension = await loader.load('ext-json');

      expect(extension).toBeDefined();
      expect(extension.name).toBe('ext-json');
      expect(extension.loaded).toBe(true);
    });

    it('should load ext-json with full path', async () => {
      const extension = await loader.load('/extensions/ext-json.wasm');

      expect(extension).toBeDefined();
      expect(extension.name).toBe('ext-json');
    });

    it('should load ext-json within reasonable time', async () => {
      const { result: extension, durationMs } = await measureTime(() => loader.load('ext-json'));

      expect(extension).toBeDefined();
      expect(durationMs).toBeLessThan(1000); // Should load in under 1 second
      console.log(`ext-json load time: ${durationMs.toFixed(2)}ms`);
    });

    it('should cache ext-json extension', async () => {
      const ext1 = await loader.load('ext-json');
      const ext2 = await loader.load('ext-json');

      expect(ext1).toBe(ext2);
    });

    it('should initialize ext-json successfully', async () => {
      const extension = await loader.load('ext-json');

      // The init function should return 0 for success
      const result = extension.call('ext_json_init');
      expect(result).toBe(0);
    });

    it('should report extension metadata', async () => {
      const extension = await loader.load('ext-json');
      const metadata = extension.getMetadata();

      expect(metadata.name).toBe('ext-json');
      expect(typeof metadata.version).toBe('string');
      expect(metadata.loadedAt).toBeGreaterThan(0);
      expect(metadata.size).toBeGreaterThan(0);
    });

    it('should list ext-json exports', async () => {
      const extension = await loader.load('ext-json');
      const exports = extension.getExports();

      expect(Array.isArray(exports)).toBe(true);
      expect(exports.length).toBeGreaterThan(0);

      // Should include our expected functions
      const expectedFunctions = [
        'ext_json_init',
        'ext_json_extract',
        'ext_json_extract_string',
        'ext_json_extract_int',
        'ext_json_extract_float',
        'ext_json_length',
        'ext_json_has',
        'ext_json_keys',
        'ext_json_values',
        'ext_json_path',
      ];

      for (const fn of expectedFunctions) {
        expect(exports).toContain(fn);
      }
    });
  });

  /**
   * Tests for ext_json_extract_string
   */
  describe('ext_json_extract_string Function', () => {
    it('should extract simple string value', async () => {
      const extension = await loader.load('ext-json');
      extension.call('ext_json_init');

      const json = '{"name": "John"}';
      const result = extension.call('ext_json_extract_string', json, '$.name');

      expect(result).toBe('John');
    });

    it('should extract nested string value', async () => {
      const extension = await loader.load('ext-json');
      extension.call('ext_json_init');

      const json = '{"person": {"name": "Alice", "city": "NYC"}}';
      const result = extension.call('ext_json_extract_string', json, '$.person.name');

      expect(result).toBe('Alice');
    });

    it('should extract string from array', async () => {
      const extension = await loader.load('ext-json');
      extension.call('ext_json_init');

      const json = '{"items": ["apple", "banana", "cherry"]}';
      const result = extension.call('ext_json_extract_string', json, '$.items[0]');

      expect(result).toBe('apple');
    });

    it('should return null for non-string value', async () => {
      const extension = await loader.load('ext-json');
      extension.call('ext_json_init');

      const json = '{"count": 42}';
      const result = extension.call('ext_json_extract_string', json, '$.count');

      expect(result).toBeNull();
    });

    it('should return null for missing path', async () => {
      const extension = await loader.load('ext-json');
      extension.call('ext_json_init');

      const json = '{"name": "John"}';
      const result = extension.call('ext_json_extract_string', json, '$.age');

      expect(result).toBeNull();
    });
  });

  /**
   * Tests for ext_json_extract_int
   */
  describe('ext_json_extract_int Function', () => {
    it('should extract simple integer value', async () => {
      const extension = await loader.load('ext-json');
      extension.call('ext_json_init');

      const json = '{"count": 42}';
      const result = extension.call('ext_json_extract_int', json, '$.count');

      expect(result).toBe(42);
    });

    it('should extract negative integer', async () => {
      const extension = await loader.load('ext-json');
      extension.call('ext_json_init');

      const json = '{"value": -17}';
      const result = extension.call('ext_json_extract_int', json, '$.value');

      expect(result).toBe(-17);
    });

    it('should extract integer from nested path', async () => {
      const extension = await loader.load('ext-json');
      extension.call('ext_json_init');

      const json = '{"data": {"count": 100}}';
      const result = extension.call('ext_json_extract_int', json, '$.data.count');

      expect(result).toBe(100);
    });

    it('should extract integer from array element', async () => {
      const extension = await loader.load('ext-json');
      extension.call('ext_json_init');

      const json = '{"values": [10, 20, 30]}';
      const result = extension.call('ext_json_extract_int', json, '$.values[1]');

      expect(result).toBe(20);
    });

    it('should return 0 for missing path', async () => {
      const extension = await loader.load('ext-json');
      extension.call('ext_json_init');

      const json = '{"name": "John"}';
      const result = extension.call('ext_json_extract_int', json, '$.count');

      expect(result).toBe(0);
    });

    it('should truncate float to integer', async () => {
      const extension = await loader.load('ext-json');
      extension.call('ext_json_init');

      const json = '{"value": 3.7}';
      const result = extension.call('ext_json_extract_int', json, '$.value');

      expect(result).toBe(3);
    });
  });

  /**
   * Tests for ext_json_extract_float
   */
  describe('ext_json_extract_float Function', () => {
    it('should extract float value', async () => {
      const extension = await loader.load('ext-json');
      extension.call('ext_json_init');

      const json = '{"price": 19.99}';
      const result = extension.call('ext_json_extract_float', json, '$.price') as number;

      expect(Math.abs(result - 19.99)).toBeLessThan(0.001);
    });

    it('should extract small float value', async () => {
      const extension = await loader.load('ext-json');
      extension.call('ext_json_init');

      const json = '{"rate": 0.05}';
      const result = extension.call('ext_json_extract_float', json, '$.rate') as number;

      expect(Math.abs(result - 0.05)).toBeLessThan(0.001);
    });

    it('should extract integer as float', async () => {
      const extension = await loader.load('ext-json');
      extension.call('ext_json_init');

      const json = '{"value": 42}';
      const result = extension.call('ext_json_extract_float', json, '$.value') as number;

      expect(Math.abs(result - 42.0)).toBeLessThan(0.001);
    });

    it('should return 0.0 for missing path', async () => {
      const extension = await loader.load('ext-json');
      extension.call('ext_json_init');

      const json = '{"name": "John"}';
      const result = extension.call('ext_json_extract_float', json, '$.price') as number;

      expect(result).toBe(0.0);
    });
  });

  /**
   * Tests for ext_json_extract (raw extraction)
   */
  describe('ext_json_extract Function', () => {
    it('should extract nested object as JSON string', async () => {
      const extension = await loader.load('ext-json');
      extension.call('ext_json_init');

      const json = '{"data": {"nested": "value"}}';
      const result = extension.call('ext_json_extract', json, '$.data') as string;

      expect(result).toBeDefined();
      const parsed = JSON.parse(result);
      expect(parsed.nested).toBe('value');
    });

    it('should extract array as JSON string', async () => {
      const extension = await loader.load('ext-json');
      extension.call('ext_json_init');

      const json = '{"items": [1, 2, 3]}';
      const result = extension.call('ext_json_extract', json, '$.items') as string;

      expect(result).toBeDefined();
      const parsed = JSON.parse(result);
      expect(parsed).toEqual([1, 2, 3]);
    });

    it('should return null for missing path', async () => {
      const extension = await loader.load('ext-json');
      extension.call('ext_json_init');

      const json = '{"name": "John"}';
      const result = extension.call('ext_json_extract', json, '$.missing');

      expect(result).toBeNull();
    });
  });

  /**
   * Tests for ext_json_length
   */
  describe('ext_json_length Function', () => {
    it('should return array length', async () => {
      const extension = await loader.load('ext-json');
      extension.call('ext_json_init');

      const json = '[1, 2, 3, 4, 5]';
      const result = extension.call('ext_json_length', json);

      expect(result).toBe(5);
    });

    it('should return empty array length', async () => {
      const extension = await loader.load('ext-json');
      extension.call('ext_json_init');

      const json = '[]';
      const result = extension.call('ext_json_length', json);

      expect(result).toBe(0);
    });

    it('should return object key count', async () => {
      const extension = await loader.load('ext-json');
      extension.call('ext_json_init');

      const json = '{"a": 1, "b": 2, "c": 3}';
      const result = extension.call('ext_json_length', json);

      expect(result).toBe(3);
    });

    it('should return empty object key count', async () => {
      const extension = await loader.load('ext-json');
      extension.call('ext_json_init');

      const json = '{}';
      const result = extension.call('ext_json_length', json);

      expect(result).toBe(0);
    });

    it('should return -1 for primitive value', async () => {
      const extension = await loader.load('ext-json');
      extension.call('ext_json_init');

      const json = '"hello"';
      const result = extension.call('ext_json_length', json);

      expect(result).toBe(-1);
    });
  });

  /**
   * Tests for ext_json_has
   */
  describe('ext_json_has Function', () => {
    it('should return 1 for existing path', async () => {
      const extension = await loader.load('ext-json');
      extension.call('ext_json_init');

      const json = '{"name": "John"}';
      const result = extension.call('ext_json_has', json, '$.name');

      expect(result).toBe(1);
    });

    it('should return 0 for missing path', async () => {
      const extension = await loader.load('ext-json');
      extension.call('ext_json_init');

      const json = '{"name": "John"}';
      const result = extension.call('ext_json_has', json, '$.age');

      expect(result).toBe(0);
    });

    it('should find nested path', async () => {
      const extension = await loader.load('ext-json');
      extension.call('ext_json_init');

      const json = '{"person": {"address": {"city": "NYC"}}}';
      const result = extension.call('ext_json_has', json, '$.person.address.city');

      expect(result).toBe(1);
    });

    it('should return 0 for partial nested path', async () => {
      const extension = await loader.load('ext-json');
      extension.call('ext_json_init');

      const json = '{"person": {"name": "John"}}';
      const result = extension.call('ext_json_has', json, '$.person.address.city');

      expect(result).toBe(0);
    });

    it('should find array index', async () => {
      const extension = await loader.load('ext-json');
      extension.call('ext_json_init');

      const json = '{"items": [1, 2, 3]}';
      const result = extension.call('ext_json_has', json, '$.items[1]');

      expect(result).toBe(1);
    });
  });

  /**
   * Tests for ext_json_keys
   */
  describe('ext_json_keys Function', () => {
    it('should return object keys as JSON array', async () => {
      const extension = await loader.load('ext-json');
      extension.call('ext_json_init');

      const json = '{"name": "John", "age": 30, "city": "NYC"}';
      const result = extension.call('ext_json_keys', json) as string;

      expect(result).toBeDefined();
      const keys = JSON.parse(result);
      expect(Array.isArray(keys)).toBe(true);
      expect(keys).toContain('name');
      expect(keys).toContain('age');
      expect(keys).toContain('city');
    });

    it('should return empty array for empty object', async () => {
      const extension = await loader.load('ext-json');
      extension.call('ext_json_init');

      const json = '{}';
      const result = extension.call('ext_json_keys', json) as string;

      expect(result).toBeDefined();
      const keys = JSON.parse(result);
      expect(keys).toEqual([]);
    });

    it('should return null for non-object', async () => {
      const extension = await loader.load('ext-json');
      extension.call('ext_json_init');

      const json = '[1, 2, 3]';
      const result = extension.call('ext_json_keys', json);

      expect(result).toBeNull();
    });
  });

  /**
   * Tests for ext_json_values
   */
  describe('ext_json_values Function', () => {
    it('should return object values as JSON array', async () => {
      const extension = await loader.load('ext-json');
      extension.call('ext_json_init');

      const json = '{"a": 1, "b": 2, "c": 3}';
      const result = extension.call('ext_json_values', json) as string;

      expect(result).toBeDefined();
      const values = JSON.parse(result);
      expect(Array.isArray(values)).toBe(true);
      expect(values).toContain(1);
      expect(values).toContain(2);
      expect(values).toContain(3);
    });

    it('should return empty array for empty object', async () => {
      const extension = await loader.load('ext-json');
      extension.call('ext_json_init');

      const json = '{}';
      const result = extension.call('ext_json_values', json) as string;

      expect(result).toBeDefined();
      const values = JSON.parse(result);
      expect(values).toEqual([]);
    });

    it('should return null for non-object', async () => {
      const extension = await loader.load('ext-json');
      extension.call('ext_json_init');

      const json = '[1, 2, 3]';
      const result = extension.call('ext_json_values', json);

      expect(result).toBeNull();
    });
  });

  /**
   * Tests for ext_json_path (JSONPath alias)
   */
  describe('ext_json_path Function', () => {
    it('should work as alias for ext_json_extract', async () => {
      const extension = await loader.load('ext-json');
      extension.call('ext_json_init');

      const json = '{"data": {"items": [1, 2, 3]}}';

      const extractResult = extension.call('ext_json_extract', json, '$.data') as string;
      const pathResult = extension.call('ext_json_path', json, '$.data') as string;

      expect(extractResult).toBe(pathResult);
    });

    it('should handle complex JSONPath', async () => {
      const extension = await loader.load('ext-json');
      extension.call('ext_json_init');

      const json = '{"users": [{"name": "Alice", "scores": [95, 87, 92]}, {"name": "Bob", "scores": [78, 82, 85]}]}';
      const result = extension.call('ext_json_path', json, '$.users[0].name') as string;

      expect(result).toBe('"Alice"');
    });
  });

  /**
   * Tests for complex JSON structures
   */
  describe('Complex JSON Structures', () => {
    it('should handle deeply nested paths', async () => {
      const extension = await loader.load('ext-json');
      extension.call('ext_json_init');

      const json = '{"a": {"b": {"c": {"d": {"e": "deep"}}}}}';
      const result = extension.call('ext_json_extract_string', json, '$.a.b.c.d.e');

      expect(result).toBe('deep');
    });

    it('should handle mixed array and object access', async () => {
      const extension = await loader.load('ext-json');
      extension.call('ext_json_init');

      const json = '{"users": [{"profile": {"settings": {"theme": "dark"}}}]}';
      const result = extension.call('ext_json_extract_string', json, '$.users[0].profile.settings.theme');

      expect(result).toBe('dark');
    });

    it('should handle array of objects', async () => {
      const extension = await loader.load('ext-json');
      extension.call('ext_json_init');

      const json = '{"items": [{"id": 1, "name": "First"}, {"id": 2, "name": "Second"}]}';

      expect(extension.call('ext_json_extract_int', json, '$.items[0].id')).toBe(1);
      expect(extension.call('ext_json_extract_string', json, '$.items[1].name')).toBe('Second');
    });

    it('should handle object with array values', async () => {
      const extension = await loader.load('ext-json');
      extension.call('ext_json_init');

      const json = '{"matrix": [[1, 2], [3, 4]]}';
      const result = extension.call('ext_json_extract', json, '$.matrix[0]') as string;

      const parsed = JSON.parse(result);
      expect(parsed).toEqual([1, 2]);
    });
  });

  /**
   * Tests for error handling
   */
  describe('Error Handling', () => {
    it('should throw for undefined function', async () => {
      const extension = await loader.load('ext-json');

      expect(() => {
        extension.call('nonexistent_function', '{}', '$.a');
      }).toThrow(/function.*not found/i);
    });

    it('should invalidate extension after unload', async () => {
      const extension = await loader.load('ext-json');
      await loader.unload('ext-json');

      expect(() => {
        extension.call('ext_json_extract', '{}', '$.a');
      }).toThrow(/unloaded|disposed|invalid/i);
    });

    it('should handle invalid JSON gracefully', async () => {
      const extension = await loader.load('ext-json');
      extension.call('ext_json_init');

      // Invalid JSON should return null or error gracefully
      const result = extension.call('ext_json_extract', 'not json', '$.a');
      expect(result).toBeNull();
    });

    it('should handle out of bounds array access', async () => {
      const extension = await loader.load('ext-json');
      extension.call('ext_json_init');

      const json = '{"items": [1, 2, 3]}';
      const result = extension.call('ext_json_extract', json, '$.items[10]');

      expect(result).toBeNull();
    });
  });

  /**
   * Tests for memory sharing with core module
   */
  describe('Memory Sharing with Core', () => {
    it('should share memory with core module', async () => {
      const extension = await loader.load('ext-json');

      const memory = extension.getMemory();

      expect(memory).toBeDefined();
      expect(memory.buffer).toBeDefined();
      expect(memory.buffer.byteLength).toBeGreaterThan(0);
    });

    it('should have valid memory base offset', async () => {
      const extension = await loader.load('ext-json');

      const memoryBase = extension.getMemoryBase();

      expect(typeof memoryBase).toBe('number');
      expect(memoryBase).toBeGreaterThanOrEqual(0);
    });

    it('should access core version', async () => {
      const extension = await loader.load('ext-json');

      const version = extension.coreVersion();

      expect(typeof version).toBe('number');
      expect(version).toBeGreaterThanOrEqual(1);
    });
  });

  /**
   * Integration tests with the full chain
   */
  describe('Full Chain Integration', () => {
    it('should complete the full load-init-extract chain', async () => {
      // 1. Load ext-json.wasm (SIDE_MODULE) via extension loader
      const extension = await loader.load('ext-json');
      expect(extension.loaded).toBe(true);

      // 2. Initialize the extension
      const initResult = extension.call('ext_json_init');
      expect(initResult).toBe(0);

      // 3. Extract values from JSON
      const json = '{"user": {"name": "Alice", "score": 95}}';

      const name = extension.call('ext_json_extract_string', json, '$.user.name');
      expect(name).toBe('Alice');

      const score = extension.call('ext_json_extract_int', json, '$.user.score');
      expect(score).toBe(95);
    });

    it('should perform multiple operations in sequence', async () => {
      const extension = await loader.load('ext-json');
      extension.call('ext_json_init');

      const json = '{"items": [{"id": 1, "value": 10.5}, {"id": 2, "value": 20.5}], "count": 2}';

      // Multiple extractions
      expect(extension.call('ext_json_extract_int', json, '$.count')).toBe(2);
      expect(extension.call('ext_json_extract_int', json, '$.items[0].id')).toBe(1);
      expect(extension.call('ext_json_extract_int', json, '$.items[1].id')).toBe(2);

      const value1 = extension.call('ext_json_extract_float', json, '$.items[0].value') as number;
      expect(Math.abs(value1 - 10.5)).toBeLessThan(0.001);

      // Check existence
      expect(extension.call('ext_json_has', json, '$.items')).toBe(1);
      expect(extension.call('ext_json_has', json, '$.missing')).toBe(0);

      // Get length
      const itemsStr = extension.call('ext_json_extract', json, '$.items') as string;
      const items = JSON.parse(itemsStr);
      expect(extension.call('ext_json_length', JSON.stringify(items))).toBe(2);
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
