/**
 * JSON Columnar Type Tests in Workers Runtime
 *
 * These tests verify the native columnar JSON data type implementation.
 * This is the MODERN approach - NOT the legacy JSONExtract functions.
 *
 * Key features tested:
 * - Schema inference from JSON samples
 * - Path syntax: data.user.name (NOT JSONExtract!)
 * - Array indexing: data.items[0].price
 * - Wildcard support: data.items[*].price
 * - Type coercion for mixed types
 * - Columnar storage and retrieval
 *
 * Reference: https://clickhouse.com/docs/en/sql-reference/data-types/newjson
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
 * Create a mock ASSETS binding that serves ext-json-columnar WASM
 */
function createMockAssets(): Fetcher {
  return {
    async fetch(input: RequestInfo | URL): Promise<Response> {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

      if (url.includes('/extensions/ext-json-columnar.wasm')) {
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
 * Test Suite: Native Columnar JSON Type
 *
 * Tests the ClickHouse-style native JSON column type with:
 * - Columnar storage (one column per unique path)
 * - Path syntax: data.user.name
 * - Automatic type inference
 *
 * SKIPPED: Requires WASM compilation not available in workerd test environment.
 * Note: mockMode was removed in the REFACTOR phase.
 */
describe.skip('Native Columnar JSON Type - SKIPPED (requires WASM compilation)', () => {
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
   * Schema Inference Tests
   *
   * Verify that the extension can infer schema from JSON samples
   */
  describe('Schema Inference', () => {
    it('should infer schema from simple object', async () => {
      const extension = await loader.load('ext-json-columnar');

      // Parse JSON and infer schema
      const json = '{"name": "Alice", "age": 30}';
      const schema = extension.call('ext_json_columnar_infer_schema', json, 0);

      expect(schema).toBeDefined();

      // Get field count
      const fieldCount = extension.call('ext_json_columnar_schema_field_count', schema);
      expect(fieldCount).toBeGreaterThanOrEqual(2);

      // Clean up
      extension.call('ext_json_columnar_free_schema', schema);
    });

    it('should infer nested object schema', async () => {
      const extension = await loader.load('ext-json-columnar');

      const json = '{"user": {"name": "Bob", "profile": {"city": "NYC"}}}';
      const schema = extension.call('ext_json_columnar_infer_schema', json, 0);

      expect(schema).toBeDefined();

      // Should discover paths: user, user.name, user.profile, user.profile.city
      const fieldCount = extension.call('ext_json_columnar_schema_field_count', schema);
      expect(fieldCount).toBeGreaterThanOrEqual(3);

      extension.call('ext_json_columnar_free_schema', schema);
    });

    it('should infer array element types', async () => {
      const extension = await loader.load('ext-json-columnar');

      const json = '{"items": [{"price": 10.5}, {"price": 20.0}]}';
      const schema = extension.call('ext_json_columnar_infer_schema', json, 0);

      expect(schema).toBeDefined();

      // Should discover: items, items[*], items[*].price
      const fieldCount = extension.call('ext_json_columnar_schema_field_count', schema);
      expect(fieldCount).toBeGreaterThanOrEqual(2);

      extension.call('ext_json_columnar_free_schema', schema);
    });

    it('should handle mixed types via coercion', async () => {
      const extension = await loader.load('ext-json-columnar');

      // First sample has integer
      const json1 = '{"value": 42}';
      const schema1 = extension.call('ext_json_columnar_infer_schema', json1, 0);

      // Check that schema was created
      expect(schema1).toBeDefined();

      extension.call('ext_json_columnar_free_schema', schema1);
    });

    it('should infer nullable fields', async () => {
      const extension = await loader.load('ext-json-columnar');

      const json = '{"name": "Alice", "nickname": null}';
      const schema = extension.call('ext_json_columnar_infer_schema', json, 0);

      expect(schema).toBeDefined();

      // nickname should be nullable
      const fieldCount = extension.call('ext_json_columnar_schema_field_count', schema);
      expect(fieldCount).toBeGreaterThanOrEqual(2);

      extension.call('ext_json_columnar_free_schema', schema);
    });
  });

  /**
   * Path Syntax Tests
   *
   * Verify the modern path syntax: data.user.name
   * NOT the legacy JSONExtract style!
   */
  describe('Path Syntax (data.user.name)', () => {
    it('should parse simple key path', async () => {
      const extension = await loader.load('ext-json-columnar');

      const path = extension.call('path_parse', 'name');
      expect(path).toBeDefined();

      const count = extension.call('path_expr_count', path);
      expect(count).toBe(1);

      extension.call('path_expr_free', path);
    });

    it('should parse nested path: user.profile.name', async () => {
      const extension = await loader.load('ext-json-columnar');

      const path = extension.call('path_parse', 'user.profile.name');
      expect(path).toBeDefined();

      const count = extension.call('path_expr_count', path);
      expect(count).toBe(3);

      extension.call('path_expr_free', path);
    });

    it('should parse array index: items[0]', async () => {
      const extension = await loader.load('ext-json-columnar');

      const path = extension.call('path_parse', 'items[0]');
      expect(path).toBeDefined();

      const count = extension.call('path_expr_count', path);
      expect(count).toBe(2); // 'items' and '[0]'

      extension.call('path_expr_free', path);
    });

    it('should parse array wildcard: items[*].price', async () => {
      const extension = await loader.load('ext-json-columnar');

      const path = extension.call('path_parse', 'items[*].price');
      expect(path).toBeDefined();

      // Check for wildcard
      const hasWildcard = extension.call('path_has_wildcard', path);
      expect(hasWildcard).toBe(true);

      extension.call('path_expr_free', path);
    });

    it('should parse mixed path: users[0].profile.settings.theme', async () => {
      const extension = await loader.load('ext-json-columnar');

      const path = extension.call('path_parse', 'users[0].profile.settings.theme');
      expect(path).toBeDefined();

      const count = extension.call('path_expr_count', path);
      expect(count).toBe(5);

      extension.call('path_expr_free', path);
    });

    it('should parse path with JSONPath-style prefix: $.user.name', async () => {
      const extension = await loader.load('ext-json-columnar');

      // Support $ prefix for compatibility
      const path = extension.call('path_parse', '$.user.name');
      expect(path).toBeDefined();

      const count = extension.call('path_expr_count', path);
      expect(count).toBe(2);

      extension.call('path_expr_free', path);
    });

    it('should convert path back to string', async () => {
      const extension = await loader.load('ext-json-columnar');

      const path = extension.call('path_parse', 'user.items[0].name');
      const str = extension.call('path_expr_to_string', path);

      expect(str).toBeDefined();
      // Should normalize to consistent format
      expect(str).toContain('user');
      expect(str).toContain('items');
      expect(str).toContain('name');

      extension.call('path_free_string', str);
      extension.call('path_expr_free', path);
    });
  });

  /**
   * Columnar Storage Tests
   *
   * Verify that JSON data is stored in columnar format
   */
  describe('Columnar Storage', () => {
    it('should create columnar storage', async () => {
      const extension = await loader.load('ext-json-columnar');

      const storage = extension.call('ext_json_columnar_storage_create', false);
      expect(storage).toBeDefined();

      extension.call('ext_json_columnar_storage_free', storage);
    });

    it('should insert JSON into columnar storage', async () => {
      const extension = await loader.load('ext-json-columnar');

      const storage = extension.call('ext_json_columnar_storage_create', false);

      const json = '{"name": "Alice", "age": 30}';
      const result = extension.call('ext_json_columnar_storage_insert', storage, json, 0);

      expect(result).toBe(0); // Success

      const rowCount = extension.call('ext_json_columnar_storage_row_count', storage);
      expect(rowCount).toBe(1);

      extension.call('ext_json_columnar_storage_free', storage);
    });

    it('should create columns for each path', async () => {
      const extension = await loader.load('ext-json-columnar');

      const storage = extension.call('ext_json_columnar_storage_create', false);

      const json = '{"user": {"name": "Bob", "age": 25}}';
      extension.call('ext_json_columnar_storage_insert', storage, json, 0);

      const colCount = extension.call('ext_json_columnar_storage_column_count', storage);
      expect(colCount).toBeGreaterThanOrEqual(2); // user.name and user.age

      extension.call('ext_json_columnar_storage_free', storage);
    });

    it('should handle multiple inserts', async () => {
      const extension = await loader.load('ext-json-columnar');

      const storage = extension.call('ext_json_columnar_storage_create', false);

      extension.call('ext_json_columnar_storage_insert', storage, '{"name": "Alice", "age": 30}', 0);
      extension.call('ext_json_columnar_storage_insert', storage, '{"name": "Bob", "age": 25}', 0);
      extension.call('ext_json_columnar_storage_insert', storage, '{"name": "Charlie", "age": 35}', 0);

      const rowCount = extension.call('ext_json_columnar_storage_row_count', storage);
      expect(rowCount).toBe(3);

      extension.call('ext_json_columnar_storage_free', storage);
    });

    it('should handle sparse data with nulls', async () => {
      const extension = await loader.load('ext-json-columnar');

      const storage = extension.call('ext_json_columnar_storage_create', false);

      // First row has 'age', second doesn't
      extension.call('ext_json_columnar_storage_insert', storage, '{"name": "Alice", "age": 30}', 0);
      extension.call('ext_json_columnar_storage_insert', storage, '{"name": "Bob"}', 0);

      const rowCount = extension.call('ext_json_columnar_storage_row_count', storage);
      expect(rowCount).toBe(2);

      extension.call('ext_json_columnar_storage_free', storage);
    });
  });

  /**
   * Query Tests
   *
   * Verify querying with path syntax
   */
  describe('Query by Path', () => {
    it('should query string value by path', async () => {
      const extension = await loader.load('ext-json-columnar');

      const storage = extension.call('ext_json_columnar_storage_create', false);
      extension.call('ext_json_columnar_storage_insert', storage, '{"name": "Alice"}', 0);

      const value = extension.call('ext_json_columnar_query_string', storage, 'name', 0);
      expect(value).toBe('Alice');

      extension.call('ext_json_columnar_storage_free', storage);
    });

    it('should query nested value by path', async () => {
      const extension = await loader.load('ext-json-columnar');

      const storage = extension.call('ext_json_columnar_storage_create', false);
      extension.call('ext_json_columnar_storage_insert', storage, '{"user": {"name": "Bob"}}', 0);

      const value = extension.call('ext_json_columnar_query_string', storage, 'user.name', 0);
      expect(value).toBe('Bob');

      extension.call('ext_json_columnar_storage_free', storage);
    });

    it('should query integer value by path', async () => {
      const extension = await loader.load('ext-json-columnar');

      const storage = extension.call('ext_json_columnar_storage_create', false);
      extension.call('ext_json_columnar_storage_insert', storage, '{"count": 42}', 0);

      const value = extension.call('ext_json_columnar_query_int', storage, 'count', 0);
      expect(value).toBe(42);

      extension.call('ext_json_columnar_storage_free', storage);
    });

    it('should query float value by path', async () => {
      const extension = await loader.load('ext-json-columnar');

      const storage = extension.call('ext_json_columnar_storage_create', false);
      extension.call('ext_json_columnar_storage_insert', storage, '{"price": 19.99}', 0);

      const value = extension.call('ext_json_columnar_query_float', storage, 'price', 0) as number;
      expect(Math.abs(value - 19.99)).toBeLessThan(0.01);

      extension.call('ext_json_columnar_storage_free', storage);
    });

    it('should return null for missing path', async () => {
      const extension = await loader.load('ext-json-columnar');

      const storage = extension.call('ext_json_columnar_storage_create', false);
      extension.call('ext_json_columnar_storage_insert', storage, '{"name": "Alice"}', 0);

      const isNull = extension.call('ext_json_columnar_query_is_null', storage, 'age', 0);
      expect(isNull).toBe(true);

      extension.call('ext_json_columnar_storage_free', storage);
    });

    it('should query multiple rows', async () => {
      const extension = await loader.load('ext-json-columnar');

      const storage = extension.call('ext_json_columnar_storage_create', false);
      extension.call('ext_json_columnar_storage_insert', storage, '{"name": "Alice", "score": 95}', 0);
      extension.call('ext_json_columnar_storage_insert', storage, '{"name": "Bob", "score": 87}', 0);
      extension.call('ext_json_columnar_storage_insert', storage, '{"name": "Charlie", "score": 92}', 0);

      expect(extension.call('ext_json_columnar_query_string', storage, 'name', 0)).toBe('Alice');
      expect(extension.call('ext_json_columnar_query_string', storage, 'name', 1)).toBe('Bob');
      expect(extension.call('ext_json_columnar_query_string', storage, 'name', 2)).toBe('Charlie');

      expect(extension.call('ext_json_columnar_query_int', storage, 'score', 0)).toBe(95);
      expect(extension.call('ext_json_columnar_query_int', storage, 'score', 1)).toBe(87);
      expect(extension.call('ext_json_columnar_query_int', storage, 'score', 2)).toBe(92);

      extension.call('ext_json_columnar_storage_free', storage);
    });
  });

  /**
   * Type Coercion Tests
   *
   * Verify that mixed types are handled correctly
   */
  describe('Type Coercion', () => {
    it('should coerce int to float when mixing types', async () => {
      const extension = await loader.load('ext-json-columnar');

      // Coercion rule: int64 + float64 = float64
      const result = extension.call('json_type_coerce', 2 /* INT64 */, 4 /* FLOAT64 */);
      expect(result).toBe(4); // FLOAT64
    });

    it('should keep null when coercing with non-null', async () => {
      const extension = await loader.load('ext-json-columnar');

      // Coercion rule: null + any = any (makes it nullable)
      const result = extension.call('json_type_coerce', 0 /* NULL */, 5 /* STRING */);
      expect(result).toBe(5); // STRING
    });

    it('should fall back to dynamic for incompatible types', async () => {
      const extension = await loader.load('ext-json-columnar');

      // Coercion rule: array + string = dynamic
      const result = extension.call('json_type_coerce', 6 /* ARRAY */, 5 /* STRING */);
      expect(result).toBe(8); // DYNAMIC
    });
  });

  /**
   * Type Information Tests
   *
   * Verify type naming and ClickHouse type mapping
   */
  describe('Type Information', () => {
    it('should return correct type names', async () => {
      const extension = await loader.load('ext-json-columnar');

      expect(extension.call('ext_json_columnar_type_name', 0)).toBe('Null');
      expect(extension.call('ext_json_columnar_type_name', 1)).toBe('Bool');
      expect(extension.call('ext_json_columnar_type_name', 2)).toBe('Int64');
      expect(extension.call('ext_json_columnar_type_name', 5)).toBe('String');
    });

    it('should return correct ClickHouse types', async () => {
      const extension = await loader.load('ext-json-columnar');

      expect(extension.call('ext_json_columnar_type_to_clickhouse', 1)).toBe('UInt8'); // Bool
      expect(extension.call('ext_json_columnar_type_to_clickhouse', 2)).toBe('Int64');
      expect(extension.call('ext_json_columnar_type_to_clickhouse', 4)).toBe('Float64');
      expect(extension.call('ext_json_columnar_type_to_clickhouse', 5)).toBe('String');
    });
  });

  /**
   * Integration Tests
   *
   * Full workflow tests
   */
  describe('Full Integration', () => {
    it('should complete the full insert-query workflow', async () => {
      const extension = await loader.load('ext-json-columnar');

      // Create storage
      const storage = extension.call('ext_json_columnar_storage_create', false);

      // Insert event data (like ClickHouse events table)
      const events = [
        '{"id": 1, "event": "click", "data": {"user": {"name": "Alice"}, "page": "/home"}}',
        '{"id": 2, "event": "view", "data": {"user": {"name": "Bob"}, "page": "/products"}}',
        '{"id": 3, "event": "click", "data": {"user": {"name": "Alice"}, "page": "/cart"}}',
      ];

      for (const event of events) {
        extension.call('ext_json_columnar_storage_insert', storage, event, 0);
      }

      // Verify row count
      const rowCount = extension.call('ext_json_columnar_storage_row_count', storage);
      expect(rowCount).toBe(3);

      // Query with path syntax (the modern way!)
      // SELECT data.user.name FROM events
      expect(extension.call('ext_json_columnar_query_string', storage, 'data.user.name', 0)).toBe('Alice');
      expect(extension.call('ext_json_columnar_query_string', storage, 'data.user.name', 1)).toBe('Bob');

      // SELECT data.page FROM events
      expect(extension.call('ext_json_columnar_query_string', storage, 'data.page', 0)).toBe('/home');
      expect(extension.call('ext_json_columnar_query_string', storage, 'data.page', 2)).toBe('/cart');

      // SELECT id FROM events
      expect(extension.call('ext_json_columnar_query_int', storage, 'id', 0)).toBe(1);
      expect(extension.call('ext_json_columnar_query_int', storage, 'id', 2)).toBe(3);

      extension.call('ext_json_columnar_storage_free', storage);
    });

    it('should handle array data with items[*].price pattern', async () => {
      const extension = await loader.load('ext-json-columnar');

      const storage = extension.call('ext_json_columnar_storage_create', false);

      // Insert order with items array
      const order = '{"order_id": 1001, "items": [{"name": "Widget", "price": 9.99}, {"name": "Gadget", "price": 19.99}]}';
      extension.call('ext_json_columnar_storage_insert', storage, order, 0);

      // Query order_id
      expect(extension.call('ext_json_columnar_query_int', storage, 'order_id', 0)).toBe(1001);

      // Column count should include nested paths
      const colCount = extension.call('ext_json_columnar_storage_column_count', storage);
      expect(colCount).toBeGreaterThanOrEqual(2);

      extension.call('ext_json_columnar_storage_free', storage);
    });

    it('should perform well with batch inserts', async () => {
      const extension = await loader.load('ext-json-columnar');

      const storage = extension.call('ext_json_columnar_storage_create', false);

      // Insert 100 rows
      const { durationMs } = await measureTime(async () => {
        for (let i = 0; i < 100; i++) {
          const json = `{"id": ${i}, "name": "User${i}", "score": ${Math.random() * 100}}`;
          extension.call('ext_json_columnar_storage_insert', storage, json, 0);
        }
      });

      const rowCount = extension.call('ext_json_columnar_storage_row_count', storage);
      expect(rowCount).toBe(100);

      console.log(`Inserted 100 rows in ${durationMs.toFixed(2)}ms`);
      expect(durationMs).toBeLessThan(5000); // Should complete in under 5 seconds

      extension.call('ext_json_columnar_storage_free', storage);
    });
  });

  /**
   * MergeTree Integration Tests
   *
   * Verify compatibility with MergeTree storage patterns
   */
  describe('MergeTree Integration Patterns', () => {
    it('should support ORDER BY key extraction', async () => {
      const extension = await loader.load('ext-json-columnar');

      const storage = extension.call('ext_json_columnar_storage_create', false);

      // Insert with timestamp (common ORDER BY key)
      extension.call('ext_json_columnar_storage_insert', storage, '{"timestamp": 1000, "event": "click"}', 0);
      extension.call('ext_json_columnar_storage_insert', storage, '{"timestamp": 2000, "event": "view"}', 0);

      // Should be able to extract timestamp for ordering
      expect(extension.call('ext_json_columnar_query_int', storage, 'timestamp', 0)).toBe(1000);
      expect(extension.call('ext_json_columnar_query_int', storage, 'timestamp', 1)).toBe(2000);

      extension.call('ext_json_columnar_storage_free', storage);
    });

    it('should support partition key extraction', async () => {
      const extension = await loader.load('ext-json-columnar');

      const storage = extension.call('ext_json_columnar_storage_create', false);

      // Insert with date (common partition key)
      extension.call('ext_json_columnar_storage_insert', storage, '{"date": "2024-01-15", "value": 100}', 0);

      // Should be able to extract date for partitioning
      const date = extension.call('ext_json_columnar_query_string', storage, 'date', 0);
      expect(date).toBe('2024-01-15');

      extension.call('ext_json_columnar_storage_free', storage);
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
