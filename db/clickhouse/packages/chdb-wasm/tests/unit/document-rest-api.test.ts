/**
 * Document REST API Tests
 *
 * Tests for REST API endpoints for document-style CRUD operations.
 * These endpoints provide MongoDB/Firebase-style document access:
 *
 * Endpoints:
 * - POST /docs/:collection - Insert document
 * - GET /docs/:collection/:id - Get document by ID
 * - PUT /docs/:collection/:id - Update document
 * - DELETE /docs/:collection/:id - Delete document
 * - GET /docs/:collection - Query documents (with optional ?query=...)
 *
 * The REST API translates operations to SQL using ReplacingMergeTree semantics.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestRequest } from '../utils/test-helpers';

// Import the document REST API handler
import { handleDocumentRequest, type DocumentApiEnv } from '../../src/document-rest-api';

describe('Document REST API', () => {
  let mockEnv: DocumentApiEnv;
  let mockDoStub: { fetch: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockDoStub = {
      fetch: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      ),
    };

    mockEnv = {
      DOCUMENT_DB_DO: {
        idFromName: vi.fn().mockReturnValue({ toString: () => 'mock-do-id' }),
        get: vi.fn().mockReturnValue(mockDoStub),
      },
    };
  });

  describe('POST /docs/:collection - Insert Document', () => {
    it('should return 201 on successful document creation', async () => {
      mockDoStub.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'abc123' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const request = createTestRequest('/docs/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Alice', email: 'alice@example.com' }),
      });

      const response = await handleDocumentRequest(request, mockEnv);
      expect(response.status).toBe(201);
    });

    it('should return the created document ID', async () => {
      mockDoStub.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'doc-12345' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const request = createTestRequest('/docs/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Widget', price: 99.99 }),
      });

      const response = await handleDocumentRequest(request, mockEnv);
      const body = await response.json() as { id: string };
      expect(body.id).toBeDefined();
      expect(typeof body.id).toBe('string');
    });

    it('should return JSON content type', async () => {
      mockDoStub.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'abc123' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const request = createTestRequest('/docs/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Bob' }),
      });

      const response = await handleDocumentRequest(request, mockEnv);
      expect(response.headers.get('Content-Type')).toContain('application/json');
    });

    it('should return 400 for invalid JSON body', async () => {
      const request = createTestRequest('/docs/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json{',
      });

      const response = await handleDocumentRequest(request, mockEnv);
      expect(response.status).toBe(400);
    });

    it('should return 400 for empty body', async () => {
      const request = createTestRequest('/docs/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '',
      });

      const response = await handleDocumentRequest(request, mockEnv);
      expect(response.status).toBe(400);
    });

    it('should extract collection name from URL path', async () => {
      mockDoStub.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'abc123' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const request = createTestRequest('/docs/my_collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: 'test' }),
      });

      await handleDocumentRequest(request, mockEnv);

      // Verify the DO was called with correct collection
      expect(mockDoStub.fetch).toHaveBeenCalled();
      const calledRequest = mockDoStub.fetch.mock.calls[0][0] as Request;
      const body = await calledRequest.clone().json() as { collection: string };
      expect(body.collection).toBe('my_collection');
    });

    it('should include CORS headers', async () => {
      mockDoStub.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'abc123' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const request = createTestRequest('/docs/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      });

      const response = await handleDocumentRequest(request, mockEnv);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('should allow custom _id field in document', async () => {
      mockDoStub.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'custom-id-123' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const request = createTestRequest('/docs/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _id: 'custom-id-123', name: 'Alice' }),
      });

      const response = await handleDocumentRequest(request, mockEnv);
      const body = await response.json() as { id: string };
      expect(body.id).toBe('custom-id-123');
    });
  });

  describe('GET /docs/:collection/:id - Get Document by ID', () => {
    it('should return 200 for existing document', async () => {
      mockDoStub.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ document: { _id: 'doc123', name: 'Alice' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const request = createTestRequest('/docs/users/doc123', {
        method: 'GET',
      });

      const response = await handleDocumentRequest(request, mockEnv);
      expect(response.status).toBe(200);
    });

    it('should return the document data', async () => {
      const expectedDoc = { _id: 'doc123', name: 'Alice', email: 'alice@example.com' };
      mockDoStub.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ document: expectedDoc }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const request = createTestRequest('/docs/users/doc123', {
        method: 'GET',
      });

      const response = await handleDocumentRequest(request, mockEnv);
      const body = await response.json() as { _id: string; name: string; email: string };
      expect(body._id).toBe('doc123');
      expect(body.name).toBe('Alice');
      expect(body.email).toBe('alice@example.com');
    });

    it('should return 404 for non-existent document', async () => {
      mockDoStub.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ document: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const request = createTestRequest('/docs/users/nonexistent', {
        method: 'GET',
      });

      const response = await handleDocumentRequest(request, mockEnv);
      expect(response.status).toBe(404);
    });

    it('should return JSON content type', async () => {
      mockDoStub.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ document: { _id: 'doc123' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const request = createTestRequest('/docs/users/doc123', {
        method: 'GET',
      });

      const response = await handleDocumentRequest(request, mockEnv);
      expect(response.headers.get('Content-Type')).toContain('application/json');
    });

    it('should include CORS headers', async () => {
      mockDoStub.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ document: { _id: 'doc123' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const request = createTestRequest('/docs/users/doc123', {
        method: 'GET',
      });

      const response = await handleDocumentRequest(request, mockEnv);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });

  describe('PUT /docs/:collection/:id - Update Document', () => {
    it('should return 200 on successful update', async () => {
      mockDoStub.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const request = createTestRequest('/docs/users/doc123', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Alice Updated' }),
      });

      const response = await handleDocumentRequest(request, mockEnv);
      expect(response.status).toBe(200);
    });

    it('should return 404 for non-existent document', async () => {
      mockDoStub.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ success: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const request = createTestRequest('/docs/users/nonexistent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });

      const response = await handleDocumentRequest(request, mockEnv);
      expect(response.status).toBe(404);
    });

    it('should return 400 for invalid JSON body', async () => {
      const request = createTestRequest('/docs/users/doc123', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json{',
      });

      const response = await handleDocumentRequest(request, mockEnv);
      expect(response.status).toBe(400);
    });

    it('should return 400 for empty body', async () => {
      const request = createTestRequest('/docs/users/doc123', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: '',
      });

      const response = await handleDocumentRequest(request, mockEnv);
      expect(response.status).toBe(400);
    });

    it('should include CORS headers', async () => {
      mockDoStub.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const request = createTestRequest('/docs/users/doc123', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });

      const response = await handleDocumentRequest(request, mockEnv);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('should pass update data to DO correctly', async () => {
      mockDoStub.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const updateData = { name: 'Alice Updated', status: 'active' };
      const request = createTestRequest('/docs/users/doc123', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      });

      await handleDocumentRequest(request, mockEnv);

      expect(mockDoStub.fetch).toHaveBeenCalled();
      const calledRequest = mockDoStub.fetch.mock.calls[0][0] as Request;
      const body = await calledRequest.clone().json() as { id: string; update: typeof updateData };
      expect(body.id).toBe('doc123');
      expect(body.update).toEqual(updateData);
    });
  });

  describe('DELETE /docs/:collection/:id - Delete Document', () => {
    it('should return 204 on successful delete', async () => {
      mockDoStub.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const request = createTestRequest('/docs/users/doc123', {
        method: 'DELETE',
      });

      const response = await handleDocumentRequest(request, mockEnv);
      expect(response.status).toBe(204);
    });

    it('should return 404 for non-existent document', async () => {
      mockDoStub.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ success: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const request = createTestRequest('/docs/users/nonexistent', {
        method: 'DELETE',
      });

      const response = await handleDocumentRequest(request, mockEnv);
      expect(response.status).toBe(404);
    });

    it('should include CORS headers', async () => {
      mockDoStub.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const request = createTestRequest('/docs/users/doc123', {
        method: 'DELETE',
      });

      const response = await handleDocumentRequest(request, mockEnv);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });

  describe('GET /docs/:collection - Query Documents', () => {
    it('should return 200 with documents array', async () => {
      mockDoStub.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ documents: [{ _id: 'doc1' }, { _id: 'doc2' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const request = createTestRequest('/docs/users', {
        method: 'GET',
      });

      const response = await handleDocumentRequest(request, mockEnv);
      expect(response.status).toBe(200);
    });

    it('should return array of documents', async () => {
      const expectedDocs = [
        { _id: 'doc1', name: 'Alice' },
        { _id: 'doc2', name: 'Bob' },
      ];
      mockDoStub.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ documents: expectedDocs }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const request = createTestRequest('/docs/users', {
        method: 'GET',
      });

      const response = await handleDocumentRequest(request, mockEnv);
      const body = await response.json() as { documents: typeof expectedDocs };
      expect(Array.isArray(body.documents)).toBe(true);
      expect(body.documents).toHaveLength(2);
    });

    it('should support query parameter for filtering', async () => {
      mockDoStub.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ documents: [{ _id: 'doc1', status: 'active' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const query = encodeURIComponent(JSON.stringify({ status: 'active' }));
      const request = createTestRequest(`/docs/users?query=${query}`, {
        method: 'GET',
      });

      await handleDocumentRequest(request, mockEnv);

      expect(mockDoStub.fetch).toHaveBeenCalled();
      const calledRequest = mockDoStub.fetch.mock.calls[0][0] as Request;
      const body = await calledRequest.clone().json() as { query: { status: string } };
      expect(body.query).toEqual({ status: 'active' });
    });

    it('should support limit parameter', async () => {
      mockDoStub.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ documents: [{ _id: 'doc1' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const request = createTestRequest('/docs/users?limit=10', {
        method: 'GET',
      });

      await handleDocumentRequest(request, mockEnv);

      expect(mockDoStub.fetch).toHaveBeenCalled();
      const calledRequest = mockDoStub.fetch.mock.calls[0][0] as Request;
      const body = await calledRequest.clone().json() as { options: { limit: number } };
      expect(body.options?.limit).toBe(10);
    });

    it('should support skip parameter for pagination', async () => {
      mockDoStub.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ documents: [{ _id: 'doc11' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const request = createTestRequest('/docs/users?skip=10', {
        method: 'GET',
      });

      await handleDocumentRequest(request, mockEnv);

      expect(mockDoStub.fetch).toHaveBeenCalled();
      const calledRequest = mockDoStub.fetch.mock.calls[0][0] as Request;
      const body = await calledRequest.clone().json() as { options: { skip: number } };
      expect(body.options?.skip).toBe(10);
    });

    it('should support sort parameter', async () => {
      mockDoStub.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ documents: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const sort = encodeURIComponent(JSON.stringify({ createdAt: -1 }));
      const request = createTestRequest(`/docs/users?sort=${sort}`, {
        method: 'GET',
      });

      await handleDocumentRequest(request, mockEnv);

      expect(mockDoStub.fetch).toHaveBeenCalled();
      const calledRequest = mockDoStub.fetch.mock.calls[0][0] as Request;
      const body = await calledRequest.clone().json() as { options: { sort: { createdAt: -1 } } };
      expect(body.options?.sort).toEqual({ createdAt: -1 });
    });

    it('should return empty array when no documents match', async () => {
      mockDoStub.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ documents: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const request = createTestRequest('/docs/users', {
        method: 'GET',
      });

      const response = await handleDocumentRequest(request, mockEnv);
      const body = await response.json() as { documents: unknown[] };
      expect(body.documents).toEqual([]);
    });

    it('should include CORS headers', async () => {
      mockDoStub.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ documents: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const request = createTestRequest('/docs/users', {
        method: 'GET',
      });

      const response = await handleDocumentRequest(request, mockEnv);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });

  describe('CORS Preflight', () => {
    it('should handle OPTIONS for POST /docs/:collection', async () => {
      const request = createTestRequest('/docs/users', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'http://example.com',
          'Access-Control-Request-Method': 'POST',
        },
      });

      const response = await handleDocumentRequest(request, mockEnv);
      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    });

    it('should handle OPTIONS for GET /docs/:collection/:id', async () => {
      const request = createTestRequest('/docs/users/doc123', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'http://example.com',
          'Access-Control-Request-Method': 'GET',
        },
      });

      const response = await handleDocumentRequest(request, mockEnv);
      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    });

    it('should handle OPTIONS for PUT /docs/:collection/:id', async () => {
      const request = createTestRequest('/docs/users/doc123', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'http://example.com',
          'Access-Control-Request-Method': 'PUT',
        },
      });

      const response = await handleDocumentRequest(request, mockEnv);
      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('PUT');
    });

    it('should handle OPTIONS for DELETE /docs/:collection/:id', async () => {
      const request = createTestRequest('/docs/users/doc123', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'http://example.com',
          'Access-Control-Request-Method': 'DELETE',
        },
      });

      const response = await handleDocumentRequest(request, mockEnv);
      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('DELETE');
    });
  });

  describe('Error Handling', () => {
    it('should return 400 for POST to /docs without collection', async () => {
      const request = createTestRequest('/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      });

      const response = await handleDocumentRequest(request, mockEnv);
      expect(response.status).toBe(400);
    });

    it('should return 500 when DO is unavailable', async () => {
      const envWithoutDo: DocumentApiEnv = {};

      const request = createTestRequest('/docs/users', {
        method: 'GET',
      });

      const response = await handleDocumentRequest(request, envWithoutDo);
      expect(response.status).toBe(500);
    });

    it('should return 500 on DO fetch error', async () => {
      mockDoStub.fetch.mockRejectedValueOnce(new Error('DO fetch failed'));

      const request = createTestRequest('/docs/users', {
        method: 'GET',
      });

      const response = await handleDocumentRequest(request, mockEnv);
      expect(response.status).toBe(500);
    });

    it('should return error message in JSON format', async () => {
      mockDoStub.fetch.mockRejectedValueOnce(new Error('DO fetch failed'));

      const request = createTestRequest('/docs/users', {
        method: 'GET',
      });

      const response = await handleDocumentRequest(request, mockEnv);
      const body = await response.json() as { error: string };
      expect(body.error).toBeDefined();
    });

    it('should return 405 for unsupported methods', async () => {
      const request = createTestRequest('/docs/users', {
        method: 'PATCH',
      });

      const response = await handleDocumentRequest(request, mockEnv);
      expect(response.status).toBe(405);
    });
  });

  describe('Collection Auto-Creation', () => {
    it('should auto-create collection on first insert if not exists', async () => {
      // First call returns collection doesn't exist error
      mockDoStub.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Collection "new_collection" does not exist' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
      // Second call creates collection
      mockDoStub.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
      // Third call inserts document
      mockDoStub.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'doc123' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const request = createTestRequest('/docs/new_collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: 'test' }),
      });

      const response = await handleDocumentRequest(request, mockEnv);
      expect(response.status).toBe(201);
    });
  });

  describe('Batch Operations', () => {
    it('should support POST /docs/:collection/batch for bulk insert', async () => {
      // First call is to create collection (may fail if exists - ignored)
      mockDoStub.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
      // Second call is the actual insertMany
      mockDoStub.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ ids: ['doc1', 'doc2', 'doc3'] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const request = createTestRequest('/docs/users/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documents: [
            { name: 'Alice' },
            { name: 'Bob' },
            { name: 'Charlie' },
          ],
        }),
      });

      const response = await handleDocumentRequest(request, mockEnv);
      expect(response.status).toBe(201);
      const body = await response.json() as { ids: string[] };
      expect(body.ids).toHaveLength(3);
    });

    it('should support DELETE /docs/:collection/batch for bulk delete', async () => {
      mockDoStub.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ deletedCount: 5 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const query = encodeURIComponent(JSON.stringify({ status: 'inactive' }));
      const request = createTestRequest(`/docs/users/batch?query=${query}`, {
        method: 'DELETE',
      });

      const response = await handleDocumentRequest(request, mockEnv);
      expect(response.status).toBe(200);
      const body = await response.json() as { deletedCount: number };
      expect(body.deletedCount).toBe(5);
    });
  });

  describe('Collection Management', () => {
    it('should support GET /docs to list all collections', async () => {
      mockDoStub.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ collections: ['users', 'products', 'orders'] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const request = createTestRequest('/docs', {
        method: 'GET',
      });

      const response = await handleDocumentRequest(request, mockEnv);
      expect(response.status).toBe(200);
      const body = await response.json() as { collections: string[] };
      expect(body.collections).toContain('users');
    });

    it('should support DELETE /docs/:collection to drop a collection', async () => {
      mockDoStub.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const request = createTestRequest('/docs/old_collection', {
        method: 'DELETE',
        headers: { 'X-Drop-Collection': 'true' },
      });

      const response = await handleDocumentRequest(request, mockEnv);
      expect(response.status).toBe(204);
    });
  });
});
