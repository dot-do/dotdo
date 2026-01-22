/**
 * Collections API Tests
 *
 * Tests for the document collections API that provides REST endpoints
 * for managing document collections (tables).
 *
 * Endpoints tested:
 * - POST /api/v1/collections - Create a new collection
 * - GET /api/v1/collections - List all collections
 * - GET /api/v1/collections/:name - Get collection info
 * - DELETE /api/v1/collections/:name - Drop a collection
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import {
  handleCollectionsRequest,
  setCollectionSqlExecutor,
  createCollection,
  listCollections,
  getCollectionInfo,
  dropCollection,
  type CollectionHandlerEnv,
} from '../../src/collection-handler';
import { createTestRequest, measureTime } from '../utils/test-helpers';

// =============================================================================
// Test Setup
// =============================================================================

describe('Collections API', () => {
  let env: CollectionHandlerEnv;
  let mockExecutor: {
    execute: ReturnType<typeof vi.fn>;
  };

  beforeAll(() => {
    env = {
      DEFAULT_DATABASE: 'default',
    };
  });

  beforeEach(() => {
    // Create a mock SQL executor
    mockExecutor = {
      execute: vi.fn().mockImplementation(async (sql: string) => {
        // Default mock: return empty result
        if (sql.includes('CREATE TABLE')) {
          return { meta: [], data: [], rows: 0 };
        }
        if (sql.includes('DROP TABLE')) {
          return { meta: [], data: [], rows: 0 };
        }
        if (sql.includes('FROM system.tables')) {
          return {
            meta: [
              { name: 'name', type: 'String' },
              { name: 'database', type: 'String' },
              { name: 'total_rows', type: 'UInt64' },
              { name: 'total_bytes', type: 'UInt64' },
            ],
            data: [],
            rows: 0,
          };
        }
        if (sql.includes('FROM system.columns')) {
          return {
            meta: [
              { name: 'name', type: 'String' },
              { name: 'type', type: 'String' },
              { name: 'default_expression', type: 'String' },
            ],
            data: [],
            rows: 0,
          };
        }
        return { meta: [], data: [], rows: 0 };
      }),
    };
    setCollectionSqlExecutor(mockExecutor);
  });

  afterEach(() => {
    setCollectionSqlExecutor(null);
    vi.clearAllMocks();
  });

  // ===========================================================================
  // POST /collections - Create Collection
  // ===========================================================================

  describe('POST /collections - Create Collection', () => {
    it('should return 201 on successful collection creation', async () => {
      const request = createTestRequest('/api/v1/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'users' }),
      });

      const response = await handleCollectionsRequest(request, env);

      expect(response.status).toBe(201);
    });

    it('should return JSON content type', async () => {
      const request = createTestRequest('/api/v1/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'users' }),
      });

      const response = await handleCollectionsRequest(request, env);

      expect(response.headers.get('Content-Type')).toContain('application/json');
    });

    it('should return success status and collection name', async () => {
      const request = createTestRequest('/api/v1/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'products' }),
      });

      const response = await handleCollectionsRequest(request, env);
      const body = await response.json() as { success: boolean; name: string };

      expect(body.success).toBe(true);
      expect(body.name).toBe('products');
    });

    it('should execute CREATE TABLE SQL', async () => {
      const request = createTestRequest('/api/v1/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'orders' }),
      });

      await handleCollectionsRequest(request, env);

      expect(mockExecutor.execute).toHaveBeenCalled();
      const sqlCall = mockExecutor.execute.mock.calls[0][0] as string;
      expect(sqlCall).toContain('CREATE TABLE');
      expect(sqlCall).toContain('orders');
      expect(sqlCall).toContain('ReplacingMergeTree');
    });

    it('should include required columns in CREATE TABLE', async () => {
      const request = createTestRequest('/api/v1/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'events' }),
      });

      await handleCollectionsRequest(request, env);

      const sqlCall = mockExecutor.execute.mock.calls[0][0] as string;
      expect(sqlCall).toContain('id String');
      expect(sqlCall).toContain('_version UInt64');
      expect(sqlCall).toContain('data String');
      expect(sqlCall).toContain('created_at DateTime64');
      expect(sqlCall).toContain('updated_at DateTime64');
      expect(sqlCall).toContain('_deleted UInt8');
    });

    it('should use ReplacingMergeTree engine with _version and _deleted', async () => {
      const request = createTestRequest('/api/v1/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'logs' }),
      });

      await handleCollectionsRequest(request, env);

      const sqlCall = mockExecutor.execute.mock.calls[0][0] as string;
      expect(sqlCall).toContain('ReplacingMergeTree(_version, _deleted)');
      expect(sqlCall).toContain('ORDER BY id');
    });

    it('should default _deleted to 0', async () => {
      const request = createTestRequest('/api/v1/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'items' }),
      });

      await handleCollectionsRequest(request, env);

      const sqlCall = mockExecutor.execute.mock.calls[0][0] as string;
      expect(sqlCall).toContain('_deleted UInt8 DEFAULT 0');
    });

    it('should return 400 when name is missing', async () => {
      const request = createTestRequest('/api/v1/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const response = await handleCollectionsRequest(request, env);

      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid collection name', async () => {
      const request = createTestRequest('/api/v1/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '123invalid' }),
      });

      const response = await handleCollectionsRequest(request, env);

      expect(response.status).toBe(400);
      const body = await response.json() as { error: string };
      expect(body.error).toContain('must start with');
    });

    it('should return 400 for reserved collection names', async () => {
      const request = createTestRequest('/api/v1/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'system' }),
      });

      const response = await handleCollectionsRequest(request, env);

      expect(response.status).toBe(400);
      const body = await response.json() as { error: string };
      expect(body.error).toContain('reserved');
    });

    it('should support custom database', async () => {
      const request = createTestRequest('/api/v1/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'users', database: 'mydb' }),
      });

      const response = await handleCollectionsRequest(request, env);
      const body = await response.json() as { database: string };

      expect(response.status).toBe(201);
      expect(body.database).toBe('mydb');
    });

    it('should support TTL setting', async () => {
      const request = createTestRequest('/api/v1/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'sessions',
          settings: { ttl: 3600 },
        }),
      });

      await handleCollectionsRequest(request, env);

      const sqlCall = mockExecutor.execute.mock.calls[0][0] as string;
      expect(sqlCall).toContain('TTL created_at + INTERVAL 3600 SECOND');
    });

    it('should include CORS headers', async () => {
      const request = createTestRequest('/api/v1/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test' }),
      });

      const response = await handleCollectionsRequest(request, env);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });

  // ===========================================================================
  // GET /collections - List Collections
  // ===========================================================================

  describe('GET /collections - List Collections', () => {
    it('should return 200 status code', async () => {
      const request = createTestRequest('/api/v1/collections', { method: 'GET' });
      const response = await handleCollectionsRequest(request, env);

      expect(response.status).toBe(200);
    });

    it('should return JSON content type', async () => {
      const request = createTestRequest('/api/v1/collections', { method: 'GET' });
      const response = await handleCollectionsRequest(request, env);

      expect(response.headers.get('Content-Type')).toContain('application/json');
    });

    it('should return collections array', async () => {
      mockExecutor.execute.mockResolvedValueOnce({
        meta: [
          { name: 'name', type: 'String' },
          { name: 'database', type: 'String' },
          { name: 'total_rows', type: 'UInt64' },
          { name: 'total_bytes', type: 'UInt64' },
        ],
        data: [
          { name: 'users', database: 'default', total_rows: 100, total_bytes: 1024 },
          { name: 'orders', database: 'default', total_rows: 500, total_bytes: 5120 },
        ],
        rows: 2,
      });

      const request = createTestRequest('/api/v1/collections', { method: 'GET' });
      const response = await handleCollectionsRequest(request, env);
      const body = await response.json() as { collections: unknown[]; count: number };

      expect(body.collections).toBeDefined();
      expect(Array.isArray(body.collections)).toBe(true);
      expect(body.count).toBe(2);
    });

    it('should return empty array when no collections exist', async () => {
      const request = createTestRequest('/api/v1/collections', { method: 'GET' });
      const response = await handleCollectionsRequest(request, env);
      const body = await response.json() as { collections: unknown[]; count: number };

      expect(body.collections).toEqual([]);
      expect(body.count).toBe(0);
    });

    it('should filter by database when specified', async () => {
      const request = createTestRequest('/api/v1/collections?database=mydb', { method: 'GET' });
      await handleCollectionsRequest(request, env);

      const sqlCall = mockExecutor.execute.mock.calls[0][0] as string;
      expect(sqlCall).toContain("database = 'mydb'");
    });

    it('should include CORS headers', async () => {
      const request = createTestRequest('/api/v1/collections', { method: 'GET' });
      const response = await handleCollectionsRequest(request, env);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('should respond within 100ms for empty list', async () => {
      const request = createTestRequest('/api/v1/collections', { method: 'GET' });

      const { durationMs } = await measureTime(async () => {
        return await handleCollectionsRequest(request, env);
      });

      expect(durationMs).toBeLessThan(100);
    });
  });

  // ===========================================================================
  // GET /collections/:name - Get Collection Info
  // ===========================================================================

  describe('GET /collections/:name - Get Collection Info', () => {
    it('should return 200 for existing collection', async () => {
      mockExecutor.execute.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM system.tables')) {
          return {
            meta: [],
            data: [
              {
                name: 'users',
                database: 'default',
                engine: 'ReplacingMergeTree',
                total_rows: 100,
                total_bytes: 1024,
                created_at: '2024-01-01 00:00:00',
              },
            ],
            rows: 1,
          };
        }
        if (sql.includes('FROM system.columns')) {
          return {
            meta: [],
            data: [
              { name: 'id', type: 'String', default_expression: '' },
              { name: '_version', type: 'UInt64', default_expression: 'toUnixTimestamp64Milli(now64())' },
              { name: 'data', type: 'String', default_expression: '' },
              { name: 'created_at', type: 'DateTime64(3)', default_expression: 'now64()' },
              { name: 'updated_at', type: 'DateTime64(3)', default_expression: 'now64()' },
            ],
            rows: 5,
          };
        }
        return { meta: [], data: [], rows: 0 };
      });

      const request = createTestRequest('/api/v1/collections/users', { method: 'GET' });
      const response = await handleCollectionsRequest(request, env);

      expect(response.status).toBe(200);
    });

    it('should return collection details', async () => {
      mockExecutor.execute.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM system.tables')) {
          return {
            meta: [],
            data: [
              {
                name: 'products',
                database: 'default',
                engine: 'ReplacingMergeTree',
                total_rows: 500,
                total_bytes: 5120,
                created_at: '2024-01-01 00:00:00',
              },
            ],
            rows: 1,
          };
        }
        if (sql.includes('FROM system.columns')) {
          return {
            meta: [],
            data: [
              { name: 'id', type: 'String', default_expression: '' },
            ],
            rows: 1,
          };
        }
        return { meta: [], data: [], rows: 0 };
      });

      const request = createTestRequest('/api/v1/collections/products', { method: 'GET' });
      const response = await handleCollectionsRequest(request, env);
      const body = await response.json() as {
        name: string;
        database: string;
        engine: string;
        total_rows: number;
        total_bytes: number;
        schema: { columns: unknown[] };
      };

      expect(body.name).toBe('products');
      expect(body.database).toBe('default');
      expect(body.engine).toContain('MergeTree');
      expect(body.total_rows).toBe(500);
      expect(body.total_bytes).toBe(5120);
      expect(body.schema).toBeDefined();
      expect(body.schema.columns).toBeDefined();
    });

    it('should return 404 for non-existent collection', async () => {
      const request = createTestRequest('/api/v1/collections/nonexistent', { method: 'GET' });
      const response = await handleCollectionsRequest(request, env);

      expect(response.status).toBe(404);
      const body = await response.json() as { error: string };
      expect(body.error).toContain('not found');
    });

    it('should return 400 for invalid collection name', async () => {
      const request = createTestRequest('/api/v1/collections/123invalid', { method: 'GET' });
      const response = await handleCollectionsRequest(request, env);

      expect(response.status).toBe(400);
    });

    it('should include CORS headers', async () => {
      const request = createTestRequest('/api/v1/collections/users', { method: 'GET' });
      const response = await handleCollectionsRequest(request, env);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });

  // ===========================================================================
  // DELETE /collections/:name - Drop Collection
  // ===========================================================================

  describe('DELETE /collections/:name - Drop Collection', () => {
    it('should return 200 on successful drop', async () => {
      const request = createTestRequest('/api/v1/collections/users', { method: 'DELETE' });
      const response = await handleCollectionsRequest(request, env);

      expect(response.status).toBe(200);
    });

    it('should return success message', async () => {
      const request = createTestRequest('/api/v1/collections/orders', { method: 'DELETE' });
      const response = await handleCollectionsRequest(request, env);
      const body = await response.json() as { success: boolean; message: string };

      expect(body.success).toBe(true);
      expect(body.message).toContain('dropped');
    });

    it('should execute DROP TABLE SQL', async () => {
      const request = createTestRequest('/api/v1/collections/products', { method: 'DELETE' });
      await handleCollectionsRequest(request, env);

      const sqlCall = mockExecutor.execute.mock.calls[0][0] as string;
      expect(sqlCall).toContain('DROP TABLE');
      expect(sqlCall).toContain('products');
    });

    it('should use IF EXISTS in DROP TABLE', async () => {
      const request = createTestRequest('/api/v1/collections/events', { method: 'DELETE' });
      await handleCollectionsRequest(request, env);

      const sqlCall = mockExecutor.execute.mock.calls[0][0] as string;
      expect(sqlCall).toContain('IF EXISTS');
    });

    it('should return 400 for invalid collection name', async () => {
      const request = createTestRequest('/api/v1/collections/123invalid', { method: 'DELETE' });
      const response = await handleCollectionsRequest(request, env);

      expect(response.status).toBe(400);
    });

    it('should include CORS headers', async () => {
      const request = createTestRequest('/api/v1/collections/test', { method: 'DELETE' });
      const response = await handleCollectionsRequest(request, env);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });

  // ===========================================================================
  // CORS Preflight
  // ===========================================================================

  describe('OPTIONS - CORS Preflight', () => {
    it('should return 204 for OPTIONS request to /collections', async () => {
      const request = createTestRequest('/api/v1/collections', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'http://example.com',
          'Access-Control-Request-Method': 'POST',
        },
      });

      const response = await handleCollectionsRequest(request, env);

      expect(response.status).toBe(204);
    });

    it('should include CORS headers in preflight response', async () => {
      const request = createTestRequest('/api/v1/collections', {
        method: 'OPTIONS',
      });

      const response = await handleCollectionsRequest(request, env);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('DELETE');
    });

    it('should return 204 for OPTIONS request to /collections/:name', async () => {
      const request = createTestRequest('/api/v1/collections/users', {
        method: 'OPTIONS',
      });

      const response = await handleCollectionsRequest(request, env);

      expect(response.status).toBe(204);
    });
  });

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('Error Handling', () => {
    it('should return 405 for unsupported methods on /collections', async () => {
      const request = createTestRequest('/api/v1/collections', { method: 'PUT' });
      const response = await handleCollectionsRequest(request, env);

      expect(response.status).toBe(405);
    });

    it('should return 405 for POST to /collections/:name', async () => {
      const request = createTestRequest('/api/v1/collections/users', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const response = await handleCollectionsRequest(request, env);

      expect(response.status).toBe(405);
    });

    it('should return 400 for collection name with slashes', async () => {
      const request = createTestRequest('/api/v1/collections/users/extra', { method: 'GET' });
      const response = await handleCollectionsRequest(request, env);

      // The route pattern will match with collection name "users/extra" which is invalid
      // This should return 400 for invalid collection name
      expect(response.status).toBe(400);
    });

    it('should handle SQL execution errors gracefully', async () => {
      mockExecutor.execute.mockRejectedValueOnce(new Error('Database connection failed'));

      const request = createTestRequest('/api/v1/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test' }),
      });

      const response = await handleCollectionsRequest(request, env);

      expect(response.status).toBe(400);
      const body = await response.json() as { error: string };
      expect(body.error).toContain('Database connection failed');
    });
  });

  // ===========================================================================
  // Unit Tests for Core Functions
  // ===========================================================================

  describe('createCollection function', () => {
    it('should create collection with default options', async () => {
      const result = await createCollection({ name: 'test' });

      expect(result.success).toBe(true);
      expect(result.name).toBe('test');
      expect(result.database).toBe('default');
    });

    it('should reject names with special characters', async () => {
      await expect(createCollection({ name: 'test-name' }))
        .rejects.toThrow('must start with');

      await expect(createCollection({ name: 'test.name' }))
        .rejects.toThrow('must start with');

      await expect(createCollection({ name: 'test name' }))
        .rejects.toThrow('must start with');
    });

    it('should reject empty name', async () => {
      await expect(createCollection({ name: '' }))
        .rejects.toThrow('required');
    });
  });

  describe('listCollections function', () => {
    it('should return empty list when no collections', async () => {
      const result = await listCollections();

      expect(result.collections).toEqual([]);
      expect(result.count).toBe(0);
    });
  });

  describe('getCollectionInfo function', () => {
    it('should return null for non-existent collection', async () => {
      const result = await getCollectionInfo('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('dropCollection function', () => {
    it('should execute DROP TABLE', async () => {
      const result = await dropCollection('test');

      expect(result.success).toBe(true);
      expect(mockExecutor.execute).toHaveBeenCalled();
    });
  });
});
