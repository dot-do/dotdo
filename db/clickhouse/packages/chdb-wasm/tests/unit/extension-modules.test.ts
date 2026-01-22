/**
 * Extension Modules (SIDE_MODULE) - RED Phase Tests
 *
 * These tests verify that WASM extension modules can be dynamically loaded
 * and executed in the Cloudflare Workers runtime. Extensions are built as
 * Emscripten SIDE_MODULEs that share memory with the core WASM module.
 *
 * Extension Categories:
 * - Format Extensions: ext-parquet, ext-json-advanced
 * - Geo Extensions: ext-geo (H3, S2, geohash)
 * - Date/Time Extensions: ext-datetime
 * - String Extensions: ext-string-advanced (regex, fuzzy matching)
 * - Aggregate Extensions: ext-aggregates-advanced (window functions, quantiles)
 * - ML/Vector Extensions: ext-ml (embeddings, cosine similarity)
 * - Compression Extensions: ext-compression (LZ4, ZSTD, Snappy)
 * - Hash Extensions: ext-hash (SHA256, MD5, xxHash)
 * - URL Extensions: ext-url (parsing, domain extraction)
 *
 * Test Categories Per Extension:
 * 1. Extension loads via dlopen()
 * 2. Extension calls core malloc/free
 * 3. Exported functions callable from JS
 * 4. Memory shared with core (zero-copy)
 * 5. Multiple extensions coexist
 * 6. Extension respects size budget
 *
 * TDD Phase: RED
 * - These tests define the expected behavior before implementation
 * - Tests will FAIL until extensions are built
 *
 * @see https://emscripten.org/docs/compiling/Dynamic-Linking.html
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';

/**
 * Extension catalog - registry of all available extensions
 */
interface ExtensionCatalog {
  /** Get extension by name */
  get(name: string): ExtensionModule | undefined;
  /** List all available extension names */
  list(): string[];
  /** Check if extension is available */
  has(name: string): boolean;
  /** Load extension by name */
  load(name: string): Promise<ExtensionModule>;
  /** Unload extension by name */
  unload(name: string): Promise<void>;
  /** Get total size of all loaded extensions */
  getTotalSize(): number;
}

/**
 * Extension module interface
 */
interface ExtensionModule {
  /** Extension name (e.g., 'ext-parquet') */
  name: string;
  /** Extension version */
  version: string;
  /** Whether extension is loaded */
  loaded: boolean;
  /** Size in bytes */
  size: number;
  /** List of exported functions */
  exports: string[];
  /** Call an exported function */
  call<T = unknown>(fn: string, ...args: unknown[]): T;
  /** Allocate memory from core */
  malloc(size: number): number;
  /** Free memory to core */
  free(ptr: number): void;
  /** Get shared memory buffer */
  getMemory(): ArrayBuffer;
}

/**
 * Create an extension catalog (placeholder - to be implemented)
 */
async function createExtensionCatalog(): Promise<ExtensionCatalog> {
  // This will be implemented in the GREEN phase
  throw new Error('Extension catalog not yet implemented - RED phase test');
}

/**
 * Maximum size budget per extension (in bytes)
 * Extensions should be kept small for edge deployment
 */
const EXTENSION_SIZE_BUDGET = 500 * 1024; // 500KB per extension

/**
 * Maximum total size for all extensions
 */
const TOTAL_EXTENSION_BUDGET = 3 * 1024 * 1024; // 3MB total

describe('Extension Modules (SIDE_MODULE) - RED Phase', () => {
  let catalog: ExtensionCatalog;

  beforeAll(async () => {
    // This will fail in RED phase - implementation doesn't exist yet
    catalog = await createExtensionCatalog();
  });

  afterEach(async () => {
    // Clean up any loaded extensions
    if (catalog) {
      const loaded = catalog.list().filter((name) => catalog.get(name)?.loaded);
      for (const name of loaded) {
        await catalog.unload(name);
      }
    }
  });

  describe('Extension Catalog/Registry', () => {
    it('should list all available extensions', async () => {
      const extensions = catalog.list();

      expect(Array.isArray(extensions)).toBe(true);
      expect(extensions.length).toBeGreaterThan(0);

      // All 10 core extensions should be available
      expect(extensions).toContain('ext-parquet');
      expect(extensions).toContain('ext-json-advanced');
      expect(extensions).toContain('ext-geo');
      expect(extensions).toContain('ext-datetime');
      expect(extensions).toContain('ext-string-advanced');
      expect(extensions).toContain('ext-aggregates-advanced');
      expect(extensions).toContain('ext-ml');
      expect(extensions).toContain('ext-compression');
      expect(extensions).toContain('ext-hash');
      expect(extensions).toContain('ext-url');
    });

    it('should check if extension is available', async () => {
      expect(catalog.has('ext-parquet')).toBe(true);
      expect(catalog.has('ext-nonexistent')).toBe(false);
    });

    it('should load extension by name', async () => {
      const ext = await catalog.load('ext-hash');

      expect(ext).toBeDefined();
      expect(ext.name).toBe('ext-hash');
      expect(ext.loaded).toBe(true);
    });

    it('should cache loaded extensions', async () => {
      const ext1 = await catalog.load('ext-hash');
      const ext2 = await catalog.load('ext-hash');

      expect(ext1).toBe(ext2);
    });

    it('should unload extension', async () => {
      await catalog.load('ext-hash');
      expect(catalog.get('ext-hash')?.loaded).toBe(true);

      await catalog.unload('ext-hash');
      expect(catalog.get('ext-hash')?.loaded).toBe(false);
    });

    it('should track total size of loaded extensions', async () => {
      await catalog.load('ext-hash');
      await catalog.load('ext-url');

      const totalSize = catalog.getTotalSize();

      expect(totalSize).toBeGreaterThan(0);
      expect(totalSize).toBeLessThan(TOTAL_EXTENSION_BUDGET);
    });

    it('should throw for missing extension', async () => {
      await expect(catalog.load('ext-nonexistent')).rejects.toThrow(
        /extension.*not found|not available/i
      );
    });
  });

  describe('Dynamic Loading via dlopen()', () => {
    it('should load extension via dlopen mechanism', async () => {
      const ext = await catalog.load('ext-hash');

      expect(ext.loaded).toBe(true);
      expect(ext.exports.length).toBeGreaterThan(0);
    });

    it('should load multiple extensions simultaneously', async () => {
      const [hash, url, geo] = await Promise.all([
        catalog.load('ext-hash'),
        catalog.load('ext-url'),
        catalog.load('ext-geo'),
      ]);

      expect(hash.loaded).toBe(true);
      expect(url.loaded).toBe(true);
      expect(geo.loaded).toBe(true);
    });

    it('should provide extension version info', async () => {
      const ext = await catalog.load('ext-hash');

      expect(typeof ext.version).toBe('string');
      expect(ext.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('should report extension size', async () => {
      const ext = await catalog.load('ext-hash');

      expect(typeof ext.size).toBe('number');
      expect(ext.size).toBeGreaterThan(0);
      expect(ext.size).toBeLessThan(EXTENSION_SIZE_BUDGET);
    });
  });

  describe('Memory Sharing with Core', () => {
    it('should share memory with core module', async () => {
      const ext = await catalog.load('ext-hash');

      const memory = ext.getMemory();

      expect(memory).toBeInstanceOf(ArrayBuffer);
      expect(memory.byteLength).toBeGreaterThan(0);
    });

    it('should allocate memory via core allocator', async () => {
      const ext = await catalog.load('ext-hash');

      const ptr = ext.malloc(1024);

      expect(typeof ptr).toBe('number');
      expect(ptr).toBeGreaterThan(0);

      // Should be able to free without error
      ext.free(ptr);
    });

    it('should share memory between extensions (zero-copy)', async () => {
      const hash = await catalog.load('ext-hash');
      const url = await catalog.load('ext-url');

      const hashMemory = hash.getMemory();
      const urlMemory = url.getMemory();

      // Both extensions should reference the same underlying memory
      expect(hashMemory).toBe(urlMemory);
    });

    it('should allow extensions to read/write to shared memory', async () => {
      const ext = await catalog.load('ext-hash');

      // Allocate memory
      const ptr = ext.malloc(256);
      const memory = ext.getMemory();
      const view = new Uint8Array(memory, ptr, 256);

      // Write test data
      const testData = new TextEncoder().encode('Hello, WASM!');
      view.set(testData);

      // Verify data was written
      expect(view[0]).toBe(testData[0]);
      expect(view[1]).toBe(testData[1]);

      ext.free(ptr);
    });
  });

  describe('Exported Functions Callable from JS', () => {
    it('should list exported functions', async () => {
      const ext = await catalog.load('ext-hash');

      expect(Array.isArray(ext.exports)).toBe(true);
      expect(ext.exports.length).toBeGreaterThan(0);
    });

    it('should call exported function', async () => {
      const ext = await catalog.load('ext-hash');

      // ext-hash should export md5 function
      expect(ext.exports).toContain('ext_hash_md5');

      // Call the function (implementation will vary)
      const result = ext.call<number>('ext_hash_md5', 'test');

      expect(result).toBeDefined();
    });

    it('should throw for undefined function', async () => {
      const ext = await catalog.load('ext-hash');

      expect(() => {
        ext.call('nonexistent_function');
      }).toThrow(/function.*not found/i);
    });
  });

  describe('Size Budget Constraints', () => {
    it('should enforce per-extension size budget', async () => {
      const extensions = catalog.list();

      for (const name of extensions) {
        const ext = await catalog.load(name);
        expect(ext.size).toBeLessThanOrEqual(EXTENSION_SIZE_BUDGET);
        await catalog.unload(name);
      }
    });

    it('should enforce total extension budget', async () => {
      const extensions = catalog.list();

      // Load all extensions
      for (const name of extensions) {
        await catalog.load(name);
      }

      const totalSize = catalog.getTotalSize();
      expect(totalSize).toBeLessThanOrEqual(TOTAL_EXTENSION_BUDGET);
    });
  });

  // ============================================================
  // Extension-Specific Tests
  // ============================================================

  describe('ext-parquet - Parquet Read/Write', () => {
    let ext: ExtensionModule;

    beforeAll(async () => {
      ext = await catalog.load('ext-parquet');
    });

    it('should export parquet functions', async () => {
      expect(ext.exports).toContain('ext_parquet_read');
      expect(ext.exports).toContain('ext_parquet_write');
      expect(ext.exports).toContain('ext_parquet_schema');
    });

    it('should read parquet file metadata', async () => {
      // Create mock parquet data (minimal valid parquet)
      const parquetData = new Uint8Array([
        0x50, 0x41, 0x52, 0x31, // PAR1 magic
        // ... (actual parquet content would go here)
      ]);

      const result = ext.call<{ columns: string[] }>('ext_parquet_schema', parquetData);

      expect(result).toBeDefined();
      expect(Array.isArray(result.columns)).toBe(true);
    });

    it('should read parquet row group', async () => {
      const result = ext.call<unknown[]>('ext_parquet_read', 'mock_data', 0, 100);

      expect(Array.isArray(result)).toBe(true);
    });

    it('should write parquet data', async () => {
      const data = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ];
      const schema = { id: 'Int32', name: 'String' };

      const result = ext.call<Uint8Array>('ext_parquet_write', data, schema);

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('ext-json-advanced - JSONPath and JSONExtract', () => {
    let ext: ExtensionModule;

    beforeAll(async () => {
      ext = await catalog.load('ext-json-advanced');
    });

    it('should export JSON functions', async () => {
      expect(ext.exports).toContain('ext_json_path');
      expect(ext.exports).toContain('ext_json_extract');
      expect(ext.exports).toContain('ext_json_extract_string');
      expect(ext.exports).toContain('ext_json_extract_int');
    });

    it('should extract value at JSONPath', async () => {
      const json = '{"user": {"name": "Alice", "age": 30}}';
      const result = ext.call<string>('ext_json_path', json, '$.user.name');

      expect(result).toBe('Alice');
    });

    it('should extract nested array element', async () => {
      const json = '{"items": [1, 2, 3]}';
      const result = ext.call<number>('ext_json_extract_int', json, '$.items[1]');

      expect(result).toBe(2);
    });

    it('should handle missing path gracefully', async () => {
      const json = '{"name": "Alice"}';
      const result = ext.call<string | null>('ext_json_extract_string', json, '$.age');

      expect(result).toBeNull();
    });

    it('should parse complex JSONPath expressions', async () => {
      const json = '{"users": [{"name": "Alice"}, {"name": "Bob"}]}';
      const result = ext.call<string[]>('ext_json_path', json, '$.users[*].name');

      expect(result).toEqual(['Alice', 'Bob']);
    });
  });

  describe('ext-geo - Geospatial Functions (H3, S2, Geohash)', () => {
    let ext: ExtensionModule;

    beforeAll(async () => {
      ext = await catalog.load('ext-geo');
    });

    it('should export geo functions', async () => {
      expect(ext.exports).toContain('ext_geo_distance');
      expect(ext.exports).toContain('ext_geo_h3_to_geo');
      expect(ext.exports).toContain('ext_geo_geo_to_h3');
      expect(ext.exports).toContain('ext_geo_geohash_encode');
      expect(ext.exports).toContain('ext_geo_point_in_polygon');
    });

    it('should calculate haversine distance', async () => {
      // SF to NYC
      const distance = ext.call<number>(
        'ext_geo_distance',
        37.7749, -122.4194, // SF
        40.7128, -74.0060  // NYC
      );

      expect(distance).toBeGreaterThan(4000000); // > 4000km
      expect(distance).toBeLessThan(4200000); // < 4200km
    });

    it('should convert coordinates to H3 index', async () => {
      const h3Index = ext.call<bigint>(
        'ext_geo_geo_to_h3',
        37.7749, -122.4194, // SF
        9 // resolution
      );

      expect(typeof h3Index).toBe('bigint');
    });

    it('should convert H3 index to coordinates', async () => {
      const h3Index = BigInt('0x8928308280fffff');
      const coords = ext.call<{ lat: number; lng: number }>('ext_geo_h3_to_geo', h3Index);

      expect(typeof coords.lat).toBe('number');
      expect(typeof coords.lng).toBe('number');
    });

    it('should encode geohash', async () => {
      const geohash = ext.call<string>(
        'ext_geo_geohash_encode',
        37.7749, -122.4194,
        6 // precision
      );

      expect(typeof geohash).toBe('string');
      expect(geohash.length).toBe(6);
    });

    it('should test point in polygon', async () => {
      const polygon = [
        [0, 0], [0, 1], [1, 1], [1, 0]
      ];

      const inside = ext.call<boolean>('ext_geo_point_in_polygon', 0.5, 0.5, polygon);
      const outside = ext.call<boolean>('ext_geo_point_in_polygon', 2.0, 2.0, polygon);

      expect(inside).toBe(true);
      expect(outside).toBe(false);
    });
  });

  describe('ext-datetime - Advanced Date/Time Functions', () => {
    let ext: ExtensionModule;

    beforeAll(async () => {
      ext = await catalog.load('ext-datetime');
    });

    it('should export datetime functions', async () => {
      expect(ext.exports).toContain('ext_datetime_parse');
      expect(ext.exports).toContain('ext_datetime_format');
      expect(ext.exports).toContain('ext_datetime_add');
      expect(ext.exports).toContain('ext_datetime_diff');
      expect(ext.exports).toContain('ext_datetime_timezone');
    });

    it('should parse ISO datetime string', async () => {
      const timestamp = ext.call<number>(
        'ext_datetime_parse',
        '2024-01-15T10:30:00Z'
      );

      expect(typeof timestamp).toBe('number');
      expect(timestamp).toBeGreaterThan(0);
    });

    it('should format timestamp', async () => {
      const timestamp = 1705313400; // 2024-01-15T10:30:00Z
      const formatted = ext.call<string>(
        'ext_datetime_format',
        timestamp,
        '%Y-%m-%d'
      );

      expect(formatted).toBe('2024-01-15');
    });

    it('should add interval to datetime', async () => {
      const timestamp = 1705313400;
      const newTimestamp = ext.call<number>(
        'ext_datetime_add',
        timestamp,
        'day',
        7
      );

      expect(newTimestamp).toBe(timestamp + 7 * 24 * 60 * 60);
    });

    it('should calculate datetime difference', async () => {
      const start = 1705313400;
      const end = start + 86400 * 30; // 30 days later

      const diff = ext.call<number>('ext_datetime_diff', start, end, 'day');

      expect(diff).toBe(30);
    });

    it('should convert timezone', async () => {
      const utc = 1705313400;
      const pst = ext.call<number>(
        'ext_datetime_timezone',
        utc,
        'America/Los_Angeles'
      );

      expect(pst).not.toBe(utc);
    });
  });

  describe('ext-string-advanced - Regex and Fuzzy Matching', () => {
    let ext: ExtensionModule;

    beforeAll(async () => {
      ext = await catalog.load('ext-string-advanced');
    });

    it('should export string functions', async () => {
      expect(ext.exports).toContain('ext_string_regex_match');
      expect(ext.exports).toContain('ext_string_regex_replace');
      expect(ext.exports).toContain('ext_string_levenshtein');
      expect(ext.exports).toContain('ext_string_fuzzy_match');
    });

    it('should match regex pattern', async () => {
      const match = ext.call<boolean>(
        'ext_string_regex_match',
        'hello@example.com',
        '^[a-z]+@[a-z]+\\.[a-z]+$'
      );

      expect(match).toBe(true);
    });

    it('should replace with regex', async () => {
      const result = ext.call<string>(
        'ext_string_regex_replace',
        'foo bar baz',
        'b(a[rz])',
        'B$1'
      );

      expect(result).toBe('foo Bar Baz');
    });

    it('should calculate Levenshtein distance', async () => {
      const distance = ext.call<number>(
        'ext_string_levenshtein',
        'kitten',
        'sitting'
      );

      expect(distance).toBe(3);
    });

    it('should perform fuzzy matching', async () => {
      const candidates = ['apple', 'application', 'banana', 'apply'];
      const result = ext.call<string[]>(
        'ext_string_fuzzy_match',
        'appl',
        candidates,
        0.8 // threshold
      );

      expect(result).toContain('apple');
      expect(result).toContain('apply');
      expect(result).not.toContain('banana');
    });
  });

  describe('ext-aggregates-advanced - Window Functions and Quantiles', () => {
    let ext: ExtensionModule;

    beforeAll(async () => {
      ext = await catalog.load('ext-aggregates-advanced');
    });

    it('should export aggregate functions', async () => {
      expect(ext.exports).toContain('ext_agg_quantile');
      expect(ext.exports).toContain('ext_agg_percentile');
      expect(ext.exports).toContain('ext_agg_moving_avg');
      expect(ext.exports).toContain('ext_agg_rank');
      expect(ext.exports).toContain('ext_agg_dense_rank');
    });

    it('should calculate quantile', async () => {
      const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const q50 = ext.call<number>('ext_agg_quantile', data, 0.5);

      expect(q50).toBe(5.5);
    });

    it('should calculate percentile', async () => {
      const data = [10, 20, 30, 40, 50];
      const p90 = ext.call<number>('ext_agg_percentile', data, 90);

      expect(p90).toBeGreaterThanOrEqual(45);
    });

    it('should calculate moving average', async () => {
      const data = [1, 2, 3, 4, 5];
      const windowSize = 3;
      const result = ext.call<number[]>('ext_agg_moving_avg', data, windowSize);

      // Moving avg: [null, null, 2, 3, 4]
      expect(result[2]).toBe(2);
      expect(result[3]).toBe(3);
      expect(result[4]).toBe(4);
    });

    it('should calculate rank', async () => {
      const values = [100, 200, 200, 300];
      const ranks = ext.call<number[]>('ext_agg_rank', values);

      expect(ranks).toEqual([1, 2, 2, 4]);
    });

    it('should calculate dense rank', async () => {
      const values = [100, 200, 200, 300];
      const ranks = ext.call<number[]>('ext_agg_dense_rank', values);

      expect(ranks).toEqual([1, 2, 2, 3]);
    });
  });

  describe('ext-ml - Vector Operations and Embeddings', () => {
    let ext: ExtensionModule;

    beforeAll(async () => {
      ext = await catalog.load('ext-ml');
    });

    it('should export ML functions', async () => {
      expect(ext.exports).toContain('ext_ml_cosine_similarity');
      expect(ext.exports).toContain('ext_ml_dot_product');
      expect(ext.exports).toContain('ext_ml_euclidean_distance');
      expect(ext.exports).toContain('ext_ml_normalize');
    });

    it('should calculate cosine similarity', async () => {
      const v1 = [1, 0, 1];
      const v2 = [0, 1, 1];

      const similarity = ext.call<number>('ext_ml_cosine_similarity', v1, v2);

      // cos(v1, v2) = (1*0 + 0*1 + 1*1) / (sqrt(2) * sqrt(2)) = 0.5
      expect(Math.abs(similarity - 0.5)).toBeLessThan(0.001);
    });

    it('should calculate dot product', async () => {
      const v1 = [1, 2, 3];
      const v2 = [4, 5, 6];

      const dot = ext.call<number>('ext_ml_dot_product', v1, v2);

      expect(dot).toBe(32); // 1*4 + 2*5 + 3*6
    });

    it('should calculate Euclidean distance', async () => {
      const v1 = [0, 0];
      const v2 = [3, 4];

      const distance = ext.call<number>('ext_ml_euclidean_distance', v1, v2);

      expect(distance).toBe(5);
    });

    it('should normalize vector', async () => {
      const v = [3, 4];
      const normalized = ext.call<number[]>('ext_ml_normalize', v);

      // Unit vector should have magnitude 1
      const magnitude = Math.sqrt(normalized[0] ** 2 + normalized[1] ** 2);
      expect(Math.abs(magnitude - 1)).toBeLessThan(0.001);
    });

    it('should handle high-dimensional embeddings', async () => {
      // 384-dimensional embedding (common for small models)
      const v1 = Array.from({ length: 384 }, () => Math.random());
      const v2 = Array.from({ length: 384 }, () => Math.random());

      const similarity = ext.call<number>('ext_ml_cosine_similarity', v1, v2);

      expect(similarity).toBeGreaterThanOrEqual(-1);
      expect(similarity).toBeLessThanOrEqual(1);
    });
  });

  describe('ext-compression - LZ4, ZSTD, Snappy', () => {
    let ext: ExtensionModule;

    beforeAll(async () => {
      ext = await catalog.load('ext-compression');
    });

    it('should export compression functions', async () => {
      expect(ext.exports).toContain('ext_compress_lz4');
      expect(ext.exports).toContain('ext_decompress_lz4');
      expect(ext.exports).toContain('ext_compress_zstd');
      expect(ext.exports).toContain('ext_decompress_zstd');
      expect(ext.exports).toContain('ext_compress_snappy');
      expect(ext.exports).toContain('ext_decompress_snappy');
    });

    it('should compress and decompress with LZ4', async () => {
      const original = new TextEncoder().encode('Hello, World! '.repeat(100));

      const compressed = ext.call<Uint8Array>('ext_compress_lz4', original);
      const decompressed = ext.call<Uint8Array>('ext_decompress_lz4', compressed);

      expect(compressed.length).toBeLessThan(original.length);
      expect(decompressed).toEqual(original);
    });

    it('should compress and decompress with ZSTD', async () => {
      const original = new TextEncoder().encode('Test data for ZSTD compression '.repeat(50));

      const compressed = ext.call<Uint8Array>('ext_compress_zstd', original);
      const decompressed = ext.call<Uint8Array>('ext_decompress_zstd', compressed);

      expect(compressed.length).toBeLessThan(original.length);
      expect(decompressed).toEqual(original);
    });

    it('should compress and decompress with Snappy', async () => {
      const original = new TextEncoder().encode('Snappy is fast! '.repeat(100));

      const compressed = ext.call<Uint8Array>('ext_compress_snappy', original);
      const decompressed = ext.call<Uint8Array>('ext_decompress_snappy', compressed);

      expect(compressed.length).toBeLessThan(original.length);
      expect(decompressed).toEqual(original);
    });

    it('should support compression level for ZSTD', async () => {
      const data = new TextEncoder().encode('Test '.repeat(1000));

      const fast = ext.call<Uint8Array>('ext_compress_zstd', data, 1);
      const best = ext.call<Uint8Array>('ext_compress_zstd', data, 19);

      // Higher level should produce smaller output
      expect(best.length).toBeLessThanOrEqual(fast.length);
    });
  });

  describe('ext-hash - SHA256, MD5, xxHash', () => {
    let ext: ExtensionModule;

    beforeAll(async () => {
      ext = await catalog.load('ext-hash');
    });

    it('should export hash functions', async () => {
      expect(ext.exports).toContain('ext_hash_md5');
      expect(ext.exports).toContain('ext_hash_sha1');
      expect(ext.exports).toContain('ext_hash_sha256');
      expect(ext.exports).toContain('ext_hash_xxhash32');
      expect(ext.exports).toContain('ext_hash_xxhash64');
    });

    it('should compute MD5 hash', async () => {
      const data = new TextEncoder().encode('hello');
      const hash = ext.call<string>('ext_hash_md5', data);

      // MD5("hello") = 5d41402abc4b2a76b9719d911017c592
      expect(hash).toBe('5d41402abc4b2a76b9719d911017c592');
    });

    it('should compute SHA-256 hash', async () => {
      const data = new TextEncoder().encode('hello');
      const hash = ext.call<string>('ext_hash_sha256', data);

      // SHA256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
      expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    });

    it('should compute xxHash32', async () => {
      const data = new TextEncoder().encode('test');
      const hash = ext.call<number>('ext_hash_xxhash32', data);

      expect(typeof hash).toBe('number');
    });

    it('should compute xxHash64', async () => {
      const data = new TextEncoder().encode('test');
      const hash = ext.call<bigint>('ext_hash_xxhash64', data);

      expect(typeof hash).toBe('bigint');
    });

    it('should compute hash from string', async () => {
      const hash = ext.call<string>('ext_hash_md5', 'hello');

      expect(hash).toBe('5d41402abc4b2a76b9719d911017c592');
    });

    it('should produce consistent hashes', async () => {
      const data = 'consistent data';
      const hash1 = ext.call<string>('ext_hash_sha256', data);
      const hash2 = ext.call<string>('ext_hash_sha256', data);

      expect(hash1).toBe(hash2);
    });
  });

  describe('ext-url - URL Parsing and Domain Extraction', () => {
    let ext: ExtensionModule;

    beforeAll(async () => {
      ext = await catalog.load('ext-url');
    });

    it('should export URL functions', async () => {
      expect(ext.exports).toContain('ext_url_parse');
      expect(ext.exports).toContain('ext_url_domain');
      expect(ext.exports).toContain('ext_url_tld');
      expect(ext.exports).toContain('ext_url_path');
      expect(ext.exports).toContain('ext_url_query');
    });

    it('should parse URL components', async () => {
      const url = 'https://user:pass@example.com:8080/path?query=value#hash';
      const parsed = ext.call<{
        protocol: string;
        host: string;
        port: number;
        path: string;
        query: string;
        hash: string;
      }>('ext_url_parse', url);

      expect(parsed.protocol).toBe('https');
      expect(parsed.host).toBe('example.com');
      expect(parsed.port).toBe(8080);
      expect(parsed.path).toBe('/path');
      expect(parsed.query).toBe('query=value');
      expect(parsed.hash).toBe('hash');
    });

    it('should extract domain', async () => {
      const domain = ext.call<string>(
        'ext_url_domain',
        'https://www.subdomain.example.com/path'
      );

      expect(domain).toBe('example.com');
    });

    it('should extract TLD', async () => {
      const tld = ext.call<string>('ext_url_tld', 'https://example.co.uk/path');

      expect(tld).toBe('co.uk');
    });

    it('should extract path', async () => {
      const path = ext.call<string>(
        'ext_url_path',
        'https://example.com/api/v1/users?id=123'
      );

      expect(path).toBe('/api/v1/users');
    });

    it('should parse query parameters', async () => {
      const params = ext.call<Record<string, string>>(
        'ext_url_query',
        'https://example.com?name=Alice&age=30&active=true'
      );

      expect(params.name).toBe('Alice');
      expect(params.age).toBe('30');
      expect(params.active).toBe('true');
    });

    it('should handle invalid URLs gracefully', async () => {
      const result = ext.call<unknown>('ext_url_parse', 'not a valid url');

      expect(result).toBeNull();
    });
  });

  describe('Multiple Extensions Coexistence', () => {
    it('should load all extensions simultaneously', async () => {
      const extensions = catalog.list();

      const loaded = await Promise.all(
        extensions.map((name) => catalog.load(name))
      );

      expect(loaded.every((ext) => ext.loaded)).toBe(true);
    });

    it('should allow cross-extension operations', async () => {
      const hash = await catalog.load('ext-hash');
      const compression = await catalog.load('ext-compression');

      // Compress data, then hash the compressed result
      const data = new TextEncoder().encode('test data');
      const compressed = compression.call<Uint8Array>('ext_compress_lz4', data);
      const hashValue = hash.call<string>('ext_hash_md5', compressed);

      expect(typeof hashValue).toBe('string');
      expect(hashValue.length).toBe(32); // MD5 is 32 hex chars
    });

    it('should share memory across all extensions', async () => {
      const extensions = catalog.list().slice(0, 3);
      const loaded = await Promise.all(extensions.map((n) => catalog.load(n)));

      const memories = loaded.map((ext) => ext.getMemory());

      // All extensions should share the same memory
      for (let i = 1; i < memories.length; i++) {
        expect(memories[i]).toBe(memories[0]);
      }
    });

    it('should isolate extension state', async () => {
      const hash1 = await catalog.load('ext-hash');

      // Unload and reload
      await catalog.unload('ext-hash');
      const hash2 = await catalog.load('ext-hash');

      // Should be fresh instances
      expect(hash2.loaded).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid extension name', async () => {
      await expect(catalog.load('ext-invalid')).rejects.toThrow();
    });

    it('should handle corrupted extension binary', async () => {
      // This tests the loader's ability to handle bad WASM
      // Implementation would need to inject corrupted data
      await expect(catalog.load('ext-corrupted')).rejects.toThrow(
        /invalid|corrupted|compile/i
      );
    });

    it('should handle out-of-memory during load', async () => {
      // Would require loading many large extensions
      // Implementation depends on actual size limits
    });

    it('should handle function call on unloaded extension', async () => {
      const ext = await catalog.load('ext-hash');
      await catalog.unload('ext-hash');

      expect(() => {
        ext.call('ext_hash_md5', 'test');
      }).toThrow(/unloaded|disposed|invalid/i);
    });
  });
});
