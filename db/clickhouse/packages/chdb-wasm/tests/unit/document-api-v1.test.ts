/**
 * Document API v1 Tests
 *
 * Tests for REST API endpoints for document CRUD operations.
 * These endpoints use SQL-based storage with DocumentQueryBuilder.
 *
 * Endpoints:
 * - POST /api/v1/collections/:name/docs - Insert document
 * - GET /api/v1/collections/:name/docs/:id - Get document by ID
 * - PUT /api/v1/collections/:name/docs/:id - Update document (upsert)
 * - DELETE /api/v1/collections/:name/docs/:id - Delete document (soft delete)
 * - POST /api/v1/collections/:name/query - Query documents
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestRequest } from '../utils/test-helpers';
import { handleDocumentApiV1Request, setDocumentApiSqlExecutor, type DocumentApiV1Env } from '../../src/document-api-v1';

// Mock SQL executor
const createMockExecutor = (responses: Record<string, unknown> = {}) => ({
  execute: vi.fn().mockImplementation(async (sql: string) => {
    // Return based on SQL type
    if (sql.includes('INSERT')) {
      return { data: [], meta: [], rows: 0 };
    }
    if (sql.includes('SELECT')) {
      return responses.select || { data: [], meta: [], rows: 0 };
    }
    return { data: [], meta: [], rows: 0 };
  }),
});

describe('Document API v1', () => {
  let mockEnv: DocumentApiV1Env;
  let mockExecutor: ReturnType<typeof createMockExecutor>;

  beforeEach(() => {
    mockEnv = {
      DEFAULT_DATABASE: 'test_db',
    };
    mockExecutor = createMockExecutor();
    setDocumentApiSqlExecutor(mockExecutor);
  });

  describe('POST /api/v1/collections/:name/docs - Insert Document', () => {
    it('should return 201 on successful document creation', async () => {
      const request = createTestRequest('/api/v1/collections/users/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Alice', email: 'alice@example.com' }),
      });

      const response = await handleDocumentApiV1Request(request, mockEnv);
      expect(response.status).toBe(201);
    });

    it('should return the created document ID', async () => {
      const request = createTestRequest('/api/v1/collections/products/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Widget', price: 99.99 }),
      });

      const response = await handleDocumentApiV1Request(request, mockEnv);
      const body = await response.json() as { id: string; success: boolean };

      expect(body.id).toBeDefined();
      expect(typeof body.id).toBe('string');
      expect(body.id.length).toBeGreaterThan(0);
      expect(body.success).toBe(true);
    });

    it('should generate an ObjectId-style ID', async () => {
      const request = createTestRequest('/api/v1/collections/users/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Bob' }),
      });

      const response = await handleDocumentApiV1Request(request, mockEnv);
      const body = await response.json() as { id: string };

      // ObjectId-style IDs are 24 hex characters (8 timestamp + 16 random)
      expect(body.id).toMatch(/^[0-9a-f]{24}$/);
    });

    it('should use custom _id if provided', async () => {
      const customId = 'my-custom-id-123';
      const request = createTestRequest('/api/v1/collections/users/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _id: customId, name: 'Charlie' }),
      });

      const response = await handleDocumentApiV1Request(request, mockEnv);
      const body = await response.json() as { id: string };

      expect(body.id).toBe(customId);
    });

    it('should return JSON content type', async () => {
      const request = createTestRequest('/api/v1/collections/users/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      });

      const response = await handleDocumentApiV1Request(request, mockEnv);
      expect(response.headers.get('Content-Type')).toContain('application/json');
    });

    it('should return 400 for empty body', async () => {
      const request = createTestRequest('/api/v1/collections/users/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '',
      });

      const response = await handleDocumentApiV1Request(request, mockEnv);
      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid JSON', async () => {
      const request = createTestRequest('/api/v1/collections/users/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json',
      });

      const response = await handleDocumentApiV1Request(request, mockEnv);
      expect(response.status).toBe(400);
    });

    it('should execute INSERT SQL', async () => {
      const request = createTestRequest('/api/v1/collections/users/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test User' }),
      });

      await handleDocumentApiV1Request(request, mockEnv);

      expect(mockExecutor.execute).toHaveBeenCalled();
      const sql = mockExecutor.execute.mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO');
      expect(sql).toContain('`test_db`.`users`');
      expect(sql).toContain('FORMAT JSONEachRow');
    });
  });

  describe('GET /api/v1/collections/:name/docs/:id - Get Document', () => {
    it('should return 200 when document is found', async () => {
      mockExecutor = createMockExecutor({
        select: {
          data: [{ id: 'doc-123', data: '{"name":"Alice"}' }],
          meta: [{ name: 'id', type: 'String' }, { name: 'data', type: 'String' }],
          rows: 1,
        },
      });
      setDocumentApiSqlExecutor(mockExecutor);

      const request = createTestRequest('/api/v1/collections/users/docs/doc-123', {
        method: 'GET',
      });

      const response = await handleDocumentApiV1Request(request, mockEnv);
      expect(response.status).toBe(200);
    });

    it('should return document with _id field', async () => {
      mockExecutor = createMockExecutor({
        select: {
          data: [{ id: 'doc-456', data: '{"name":"Bob","email":"bob@test.com"}' }],
          meta: [],
          rows: 1,
        },
      });
      setDocumentApiSqlExecutor(mockExecutor);

      const request = createTestRequest('/api/v1/collections/users/docs/doc-456', {
        method: 'GET',
      });

      const response = await handleDocumentApiV1Request(request, mockEnv);
      const body = await response.json() as { _id: string; name: string; email: string };

      expect(body._id).toBe('doc-456');
      expect(body.name).toBe('Bob');
      expect(body.email).toBe('bob@test.com');
    });

    it('should return 404 when document is not found', async () => {
      mockExecutor = createMockExecutor({
        select: { data: [], meta: [], rows: 0 },
      });
      setDocumentApiSqlExecutor(mockExecutor);

      const request = createTestRequest('/api/v1/collections/users/docs/nonexistent', {
        method: 'GET',
      });

      const response = await handleDocumentApiV1Request(request, mockEnv);
      expect(response.status).toBe(404);
    });

    it('should execute SELECT with FINAL and _deleted check', async () => {
      mockExecutor = createMockExecutor({
        select: { data: [], meta: [], rows: 0 },
      });
      setDocumentApiSqlExecutor(mockExecutor);

      const request = createTestRequest('/api/v1/collections/users/docs/test-id', {
        method: 'GET',
      });

      await handleDocumentApiV1Request(request, mockEnv);

      const sql = mockExecutor.execute.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT');
      expect(sql).toContain('FINAL');
      expect(sql).toContain("id = 'test-id'");
      expect(sql).toContain('_deleted = 0');
    });
  });

  describe('PUT /api/v1/collections/:name/docs/:id - Update Document', () => {
    it('should return 200 on successful update', async () => {
      const request = createTestRequest('/api/v1/collections/users/docs/user-123', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Name' }),
      });

      const response = await handleDocumentApiV1Request(request, mockEnv);
      expect(response.status).toBe(200);
    });

    it('should return success response with ID', async () => {
      const request = createTestRequest('/api/v1/collections/users/docs/user-456', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      });

      const response = await handleDocumentApiV1Request(request, mockEnv);
      const body = await response.json() as { success: boolean; id: string };

      expect(body.success).toBe(true);
      expect(body.id).toBe('user-456');
    });

    it('should execute INSERT (upsert via ReplacingMergeTree)', async () => {
      const request = createTestRequest('/api/v1/collections/users/docs/user-789', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'new@email.com' }),
      });

      await handleDocumentApiV1Request(request, mockEnv);

      const sql = mockExecutor.execute.mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO');
      expect(sql).toContain('"id":"user-789"');
      expect(sql).toContain('_version');
    });

    it('should return 400 for empty body', async () => {
      const request = createTestRequest('/api/v1/collections/users/docs/user-123', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: '',
      });

      const response = await handleDocumentApiV1Request(request, mockEnv);
      expect(response.status).toBe(400);
    });
  });

  describe('DELETE /api/v1/collections/:name/docs/:id - Delete Document', () => {
    it('should return 204 on successful delete', async () => {
      const request = createTestRequest('/api/v1/collections/users/docs/user-to-delete', {
        method: 'DELETE',
      });

      const response = await handleDocumentApiV1Request(request, mockEnv);
      expect(response.status).toBe(204);
    });

    it('should execute soft delete (INSERT with _deleted = 1)', async () => {
      const request = createTestRequest('/api/v1/collections/users/docs/delete-me', {
        method: 'DELETE',
      });

      await handleDocumentApiV1Request(request, mockEnv);

      const sql = mockExecutor.execute.mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO');
      expect(sql).toContain('"id":"delete-me"');
      expect(sql).toContain('"_deleted":1');
    });
  });

  describe('GET /api/v1/collections/:name/docs - List Documents', () => {
    it('should return 200 on successful list', async () => {
      mockExecutor = createMockExecutor({
        select: { data: [], meta: [], rows: 0 },
      });
      setDocumentApiSqlExecutor(mockExecutor);

      const request = createTestRequest('/api/v1/collections/users/docs', {
        method: 'GET',
      });

      const response = await handleDocumentApiV1Request(request, mockEnv);
      expect(response.status).toBe(200);
    });

    it('should return documents array', async () => {
      mockExecutor = createMockExecutor({
        select: {
          data: [
            { id: 'doc-1', data: '{"name":"Alice"}' },
            { id: 'doc-2', data: '{"name":"Bob"}' },
          ],
          meta: [],
          rows: 2,
        },
      });
      setDocumentApiSqlExecutor(mockExecutor);

      const request = createTestRequest('/api/v1/collections/users/docs', {
        method: 'GET',
      });

      const response = await handleDocumentApiV1Request(request, mockEnv);
      const body = await response.json() as { documents: unknown[]; count: number };

      expect(body.documents).toHaveLength(2);
      expect(body.count).toBe(2);
    });

    it('should apply filter from query parameter', async () => {
      mockExecutor = createMockExecutor({
        select: { data: [], meta: [], rows: 0 },
      });
      setDocumentApiSqlExecutor(mockExecutor);

      const filter = JSON.stringify({ status: 'active' });
      const request = createTestRequest(`/api/v1/collections/users/docs?filter=${encodeURIComponent(filter)}`, {
        method: 'GET',
      });

      await handleDocumentApiV1Request(request, mockEnv);

      const sql = mockExecutor.execute.mock.calls[0][0] as string;
      expect(sql).toContain("'active'");
    });

    it('should apply sort from query parameter', async () => {
      mockExecutor = createMockExecutor({
        select: { data: [], meta: [], rows: 0 },
      });
      setDocumentApiSqlExecutor(mockExecutor);

      const sort = JSON.stringify({ name: 1, created_at: -1 });
      const request = createTestRequest(`/api/v1/collections/products/docs?sort=${encodeURIComponent(sort)}`, {
        method: 'GET',
      });

      await handleDocumentApiV1Request(request, mockEnv);

      const sql = mockExecutor.execute.mock.calls[0][0] as string;
      expect(sql).toContain('ORDER BY');
      expect(sql).toContain('ASC');
      expect(sql).toContain('DESC');
    });

    it('should apply limit from query parameter', async () => {
      mockExecutor = createMockExecutor({
        select: { data: [], meta: [], rows: 0 },
      });
      setDocumentApiSqlExecutor(mockExecutor);

      const request = createTestRequest('/api/v1/collections/users/docs?limit=10', {
        method: 'GET',
      });

      await handleDocumentApiV1Request(request, mockEnv);

      const sql = mockExecutor.execute.mock.calls[0][0] as string;
      expect(sql).toContain('LIMIT 10');
    });

    it('should apply skip from query parameter', async () => {
      mockExecutor = createMockExecutor({
        select: { data: [], meta: [], rows: 0 },
      });
      setDocumentApiSqlExecutor(mockExecutor);

      const request = createTestRequest('/api/v1/collections/users/docs?skip=20', {
        method: 'GET',
      });

      await handleDocumentApiV1Request(request, mockEnv);

      const sql = mockExecutor.execute.mock.calls[0][0] as string;
      expect(sql).toContain('OFFSET 20');
    });

    it('should always exclude deleted documents', async () => {
      mockExecutor = createMockExecutor({
        select: { data: [], meta: [], rows: 0 },
      });
      setDocumentApiSqlExecutor(mockExecutor);

      const request = createTestRequest('/api/v1/collections/users/docs', {
        method: 'GET',
      });

      await handleDocumentApiV1Request(request, mockEnv);

      const sql = mockExecutor.execute.mock.calls[0][0] as string;
      expect(sql).toContain('_deleted = 0');
    });

    it('should return 400 for invalid filter JSON', async () => {
      const request = createTestRequest('/api/v1/collections/users/docs?filter=invalid', {
        method: 'GET',
      });

      const response = await handleDocumentApiV1Request(request, mockEnv);
      expect(response.status).toBe(400);
      const body = await response.json() as { error: string };
      expect(body.error).toContain('Invalid filter');
    });

    it('should return 400 for invalid sort JSON', async () => {
      const request = createTestRequest('/api/v1/collections/users/docs?sort=invalid', {
        method: 'GET',
      });

      const response = await handleDocumentApiV1Request(request, mockEnv);
      expect(response.status).toBe(400);
      const body = await response.json() as { error: string };
      expect(body.error).toContain('Invalid sort');
    });

    it('should return 400 for invalid limit', async () => {
      const request = createTestRequest('/api/v1/collections/users/docs?limit=abc', {
        method: 'GET',
      });

      const response = await handleDocumentApiV1Request(request, mockEnv);
      expect(response.status).toBe(400);
      const body = await response.json() as { error: string };
      expect(body.error).toContain('Invalid limit');
    });

    it('should return 400 for negative skip', async () => {
      const request = createTestRequest('/api/v1/collections/users/docs?skip=-5', {
        method: 'GET',
      });

      const response = await handleDocumentApiV1Request(request, mockEnv);
      expect(response.status).toBe(400);
      const body = await response.json() as { error: string };
      expect(body.error).toContain('Invalid skip');
    });

    it('should combine filter, sort, limit, and skip', async () => {
      mockExecutor = createMockExecutor({
        select: { data: [], meta: [], rows: 0 },
      });
      setDocumentApiSqlExecutor(mockExecutor);

      const filter = JSON.stringify({ category: 'electronics' });
      const sort = JSON.stringify({ price: -1 });
      const request = createTestRequest(
        `/api/v1/collections/products/docs?filter=${encodeURIComponent(filter)}&sort=${encodeURIComponent(sort)}&limit=10&skip=5`,
        { method: 'GET' }
      );

      await handleDocumentApiV1Request(request, mockEnv);

      const sql = mockExecutor.execute.mock.calls[0][0] as string;
      expect(sql).toContain("'electronics'");
      expect(sql).toContain('ORDER BY');
      expect(sql).toContain('DESC');
      expect(sql).toContain('LIMIT 10');
      expect(sql).toContain('OFFSET 5');
    });
  });

  describe('POST /api/v1/collections/:name/query - Query Documents', () => {
    it('should return 200 on successful query', async () => {
      mockExecutor = createMockExecutor({
        select: { data: [], meta: [], rows: 0 },
      });
      setDocumentApiSqlExecutor(mockExecutor);

      const request = createTestRequest('/api/v1/collections/users/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filter: { status: 'active' } }),
      });

      const response = await handleDocumentApiV1Request(request, mockEnv);
      expect(response.status).toBe(200);
    });

    it('should return documents array', async () => {
      mockExecutor = createMockExecutor({
        select: {
          data: [
            { id: 'doc-1', data: '{"name":"Alice"}' },
            { id: 'doc-2', data: '{"name":"Bob"}' },
          ],
          meta: [],
          rows: 2,
        },
      });
      setDocumentApiSqlExecutor(mockExecutor);

      const request = createTestRequest('/api/v1/collections/users/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const response = await handleDocumentApiV1Request(request, mockEnv);
      const body = await response.json() as { documents: unknown[]; count: number };

      expect(body.documents).toHaveLength(2);
      expect(body.count).toBe(2);
    });

    it('should apply filter to query', async () => {
      mockExecutor = createMockExecutor({
        select: { data: [], meta: [], rows: 0 },
      });
      setDocumentApiSqlExecutor(mockExecutor);

      const request = createTestRequest('/api/v1/collections/products/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filter: { category: 'electronics', price: { $lt: 100 } },
        }),
      });

      await handleDocumentApiV1Request(request, mockEnv);

      const sql = mockExecutor.execute.mock.calls[0][0] as string;
      expect(sql).toContain("'electronics'");
      expect(sql).toContain('< 100');
    });

    it('should apply sort to query', async () => {
      mockExecutor = createMockExecutor({
        select: { data: [], meta: [], rows: 0 },
      });
      setDocumentApiSqlExecutor(mockExecutor);

      const request = createTestRequest('/api/v1/collections/products/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sort: { price: -1, name: 1 },
        }),
      });

      await handleDocumentApiV1Request(request, mockEnv);

      const sql = mockExecutor.execute.mock.calls[0][0] as string;
      expect(sql).toContain('ORDER BY');
      expect(sql).toContain('DESC');
      expect(sql).toContain('ASC');
    });

    it('should apply limit and skip to query', async () => {
      mockExecutor = createMockExecutor({
        select: { data: [], meta: [], rows: 0 },
      });
      setDocumentApiSqlExecutor(mockExecutor);

      const request = createTestRequest('/api/v1/collections/users/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          limit: 10,
          skip: 20,
        }),
      });

      await handleDocumentApiV1Request(request, mockEnv);

      const sql = mockExecutor.execute.mock.calls[0][0] as string;
      expect(sql).toContain('LIMIT 10');
      expect(sql).toContain('OFFSET 20');
    });

    it('should always exclude deleted documents', async () => {
      mockExecutor = createMockExecutor({
        select: { data: [], meta: [], rows: 0 },
      });
      setDocumentApiSqlExecutor(mockExecutor);

      const request = createTestRequest('/api/v1/collections/users/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      await handleDocumentApiV1Request(request, mockEnv);

      const sql = mockExecutor.execute.mock.calls[0][0] as string;
      expect(sql).toContain('_deleted = 0');
    });

    it('should work with empty body', async () => {
      mockExecutor = createMockExecutor({
        select: { data: [], meta: [], rows: 0 },
      });
      setDocumentApiSqlExecutor(mockExecutor);

      const request = createTestRequest('/api/v1/collections/users/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '',
      });

      const response = await handleDocumentApiV1Request(request, mockEnv);
      expect(response.status).toBe(200);
    });
  });

  describe('CORS headers', () => {
    it('should include CORS headers on success responses', async () => {
      const request = createTestRequest('/api/v1/collections/users/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      });

      const response = await handleDocumentApiV1Request(request, mockEnv);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('should handle OPTIONS preflight requests', async () => {
      const request = createTestRequest('/api/v1/collections/users/docs', {
        method: 'OPTIONS',
      });

      const response = await handleDocumentApiV1Request(request, mockEnv);

      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('PUT');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('DELETE');
    });
  });

  describe('Error handling', () => {
    it('should return 404 for unknown paths', async () => {
      const request = createTestRequest('/api/v1/unknown/path', {
        method: 'GET',
      });

      const response = await handleDocumentApiV1Request(request, mockEnv);
      expect(response.status).toBe(404);
    });

    it('should return 400 for invalid collection name', async () => {
      const request = createTestRequest('/api/v1/collections/123invalid/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      });

      const response = await handleDocumentApiV1Request(request, mockEnv);
      expect(response.status).toBe(400);
    });

    it('should return 405 for invalid methods on docs endpoint', async () => {
      const request = createTestRequest('/api/v1/collections/users/docs', {
        method: 'PATCH',
      });

      const response = await handleDocumentApiV1Request(request, mockEnv);
      expect(response.status).toBe(405);
    });

    it('should return 405 for GET on query endpoint', async () => {
      const request = createTestRequest('/api/v1/collections/users/query', {
        method: 'GET',
      });

      const response = await handleDocumentApiV1Request(request, mockEnv);
      expect(response.status).toBe(405);
    });

    it('should return 500 when executor fails', async () => {
      mockExecutor.execute.mockRejectedValueOnce(new Error('Database connection failed'));

      const request = createTestRequest('/api/v1/collections/users/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      });

      const response = await handleDocumentApiV1Request(request, mockEnv);
      expect(response.status).toBe(500);

      const body = await response.json() as { error: string };
      expect(body.error).toContain('Database connection failed');
    });
  });

  describe('Collection name validation', () => {
    it('should accept valid collection names', async () => {
      const validNames = ['users', 'order_items', 'ProductCatalog', '_private', 'a1'];

      for (const name of validNames) {
        const request = createTestRequest(`/api/v1/collections/${name}/docs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ test: true }),
        });

        const response = await handleDocumentApiV1Request(request, mockEnv);
        expect(response.status).toBe(201);
      }
    });

    it('should reject invalid collection names', async () => {
      const invalidNames = ['123start', 'has-dash', 'has.dot', 'has space'];

      for (const name of invalidNames) {
        const request = createTestRequest(`/api/v1/collections/${name}/docs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ test: true }),
        });

        const response = await handleDocumentApiV1Request(request, mockEnv);
        expect(response.status).toBe(400);
      }
    });
  });
});
