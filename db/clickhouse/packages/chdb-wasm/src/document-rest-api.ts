/**
 * Document REST API Handler
 *
 * Provides REST API endpoints for MongoDB/Firebase-style document operations.
 * Routes requests to the DocumentDBDO Durable Object for persistence.
 *
 * Endpoints:
 * - GET /docs - List all collections
 * - POST /docs/:collection - Insert document
 * - GET /docs/:collection - Query documents
 * - GET /docs/:collection/:id - Get document by ID
 * - PUT /docs/:collection/:id - Update document
 * - DELETE /docs/:collection/:id - Delete document
 * - POST /docs/:collection/batch - Bulk insert
 * - DELETE /docs/:collection/batch - Bulk delete
 * - DELETE /docs/:collection (with X-Drop-Collection header) - Drop collection
 *
 * @module document-rest-api
 */

import { createLogger } from './utils/logger';

const log = createLogger('document-rest-api');

/**
 * CORS headers for cross-origin access
 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Drop-Collection',
};

/**
 * Durable Object namespace interface
 */
export interface DurableObjectNamespace {
  idFromName(name: string): { toString(): string };
  get(id: { toString(): string }): DurableObjectStub;
}

/**
 * Durable Object stub interface
 */
export interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
}

/**
 * Environment for the Document REST API handler
 */
export interface DocumentApiEnv {
  /**
   * Durable Object binding for Document DB
   */
  DOCUMENT_DB_DO?: DurableObjectNamespace;

  /**
   * Default database name (for multi-tenant scenarios)
   */
  DEFAULT_DATABASE?: string;
}

/**
 * Parsed path information
 */
interface ParsedPath {
  collection?: string;
  documentId?: string;
  isBatch?: boolean;
}

/**
 * Parse the URL path to extract collection and document ID
 */
function parsePath(pathname: string): ParsedPath {
  // Remove /docs prefix
  const path = pathname.replace(/^\/docs\/?/, '');

  if (!path) {
    return {};
  }

  const parts = path.split('/').filter(Boolean);

  if (parts.length === 0) {
    return {};
  }

  if (parts.length === 1) {
    return { collection: parts[0] };
  }

  // Check for batch operations
  if (parts[1] === 'batch') {
    return { collection: parts[0], isBatch: true };
  }

  return {
    collection: parts[0],
    documentId: parts[1],
  };
}

/**
 * Create a JSON response with CORS headers
 */
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

/**
 * Create an error response
 */
function errorResponse(message: string, status = 500): Response {
  return jsonResponse({ error: message }, status);
}

/**
 * Create a no-content response (204)
 */
function noContentResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

/**
 * Get the Durable Object stub for the document database
 */
function getDocumentDbStub(env: DocumentApiEnv, database?: string): DurableObjectStub {
  if (!env.DOCUMENT_DB_DO) {
    throw new Error('DOCUMENT_DB_DO binding not configured');
  }

  const dbName = database || env.DEFAULT_DATABASE || 'default';
  const id = env.DOCUMENT_DB_DO.idFromName(dbName);
  return env.DOCUMENT_DB_DO.get(id);
}

/**
 * Forward a request to the Durable Object
 */
async function forwardToDocumentDb(
  env: DocumentApiEnv,
  path: string,
  method: string,
  body?: unknown,
  database?: string
): Promise<Response> {
  const stub = getDocumentDbStub(env, database);

  const request = new Request(`http://internal${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

  return stub.fetch(request);
}

/**
 * Parse JSON body safely
 */
async function parseJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const text = await request.text();
    if (!text || text.trim() === '') {
      return null;
    }
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Handle POST /docs/:collection - Insert document
 */
async function handleInsert(
  env: DocumentApiEnv,
  collection: string,
  request: Request
): Promise<Response> {
  const body = await parseJsonBody(request);
  if (!body) {
    return errorResponse('Invalid or empty JSON body', 400);
  }

  try {
    const response = await forwardToDocumentDb(env, '/insert', 'POST', {
      collection,
      document: body,
    });

    const result = await response.json() as { id?: string; error?: string };

    if (result.error) {
      // Check if it's a "collection doesn't exist" error and auto-create
      if (result.error.includes('does not exist')) {
        // Create the collection first
        await forwardToDocumentDb(env, '/createCollection', 'POST', { name: collection });
        // Retry the insert
        const retryResponse = await forwardToDocumentDb(env, '/insert', 'POST', {
          collection,
          document: body,
        });
        const retryResult = await retryResponse.json() as { id?: string; error?: string };
        if (retryResult.error) {
          return errorResponse(retryResult.error, 500);
        }
        return jsonResponse({ id: retryResult.id }, 201);
      }
      return errorResponse(result.error, 500);
    }

    return jsonResponse({ id: result.id }, 201);
  } catch (error) {
    log.error('Insert error', { collection, error: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : 'Insert failed', 500);
  }
}

/**
 * Handle GET /docs/:collection/:id - Get document by ID
 */
async function handleGetById(
  env: DocumentApiEnv,
  collection: string,
  documentId: string
): Promise<Response> {
  try {
    const response = await forwardToDocumentDb(env, '/findById', 'POST', {
      collection,
      id: documentId,
    });

    const result = await response.json() as { document?: Record<string, unknown> | null; error?: string };

    if (result.error) {
      return errorResponse(result.error, 500);
    }

    if (!result.document) {
      return errorResponse('Document not found', 404);
    }

    return jsonResponse(result.document);
  } catch (error) {
    log.error('GetById error', { collection, documentId, error: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : 'Get failed', 500);
  }
}

/**
 * Handle GET /docs/:collection - Query documents
 */
async function handleQuery(
  env: DocumentApiEnv,
  collection: string,
  url: URL
): Promise<Response> {
  try {
    // Parse query parameters
    const queryParam = url.searchParams.get('query');
    const limitParam = url.searchParams.get('limit');
    const skipParam = url.searchParams.get('skip');
    const sortParam = url.searchParams.get('sort');

    let query: Record<string, unknown> = {};
    if (queryParam) {
      try {
        query = JSON.parse(queryParam) as Record<string, unknown>;
      } catch {
        return errorResponse('Invalid query parameter JSON', 400);
      }
    }

    const options: { limit?: number; skip?: number; sort?: Record<string, 1 | -1> } = {};
    if (limitParam) {
      options.limit = parseInt(limitParam, 10);
    }
    if (skipParam) {
      options.skip = parseInt(skipParam, 10);
    }
    if (sortParam) {
      try {
        options.sort = JSON.parse(sortParam) as Record<string, 1 | -1>;
      } catch {
        return errorResponse('Invalid sort parameter JSON', 400);
      }
    }

    const response = await forwardToDocumentDb(env, '/find', 'POST', {
      collection,
      query,
      options,
    });

    const result = await response.json() as { documents?: unknown[]; error?: string };

    if (result.error) {
      return errorResponse(result.error, 500);
    }

    return jsonResponse({ documents: result.documents || [] });
  } catch (error) {
    log.error('Query error', { collection, error: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : 'Query failed', 500);
  }
}

/**
 * Handle PUT /docs/:collection/:id - Update document
 */
async function handleUpdate(
  env: DocumentApiEnv,
  collection: string,
  documentId: string,
  request: Request
): Promise<Response> {
  const body = await parseJsonBody(request);
  if (!body) {
    return errorResponse('Invalid or empty JSON body', 400);
  }

  try {
    const response = await forwardToDocumentDb(env, '/update', 'POST', {
      collection,
      id: documentId,
      update: body,
    });

    const result = await response.json() as { success?: boolean; error?: string };

    if (result.error) {
      return errorResponse(result.error, 500);
    }

    if (!result.success) {
      return errorResponse('Document not found', 404);
    }

    return jsonResponse({ success: true });
  } catch (error) {
    log.error('Update error', { collection, documentId, error: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : 'Update failed', 500);
  }
}

/**
 * Handle DELETE /docs/:collection/:id - Delete document
 */
async function handleDelete(
  env: DocumentApiEnv,
  collection: string,
  documentId: string
): Promise<Response> {
  try {
    const response = await forwardToDocumentDb(env, '/delete', 'POST', {
      collection,
      id: documentId,
    });

    const result = await response.json() as { success?: boolean; error?: string };

    if (result.error) {
      return errorResponse(result.error, 500);
    }

    if (!result.success) {
      return errorResponse('Document not found', 404);
    }

    return noContentResponse();
  } catch (error) {
    log.error('Delete error', { collection, documentId, error: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : 'Delete failed', 500);
  }
}

/**
 * Handle POST /docs/:collection/batch - Bulk insert
 */
async function handleBatchInsert(
  env: DocumentApiEnv,
  collection: string,
  request: Request
): Promise<Response> {
  const body = await parseJsonBody(request);
  if (!body || !Array.isArray(body.documents)) {
    return errorResponse('Invalid body: expected { documents: [...] }', 400);
  }

  try {
    // Ensure collection exists
    await forwardToDocumentDb(env, '/createCollection', 'POST', { name: collection }).catch(() => {
      // Collection might already exist, ignore error
    });

    const response = await forwardToDocumentDb(env, '/insertMany', 'POST', {
      collection,
      documents: body.documents,
    });

    const result = await response.json() as { ids?: string[]; error?: string };

    if (result.error) {
      return errorResponse(result.error, 500);
    }

    return jsonResponse({ ids: result.ids || [] }, 201);
  } catch (error) {
    log.error('Batch insert error', { collection, error: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : 'Batch insert failed', 500);
  }
}

/**
 * Handle DELETE /docs/:collection/batch - Bulk delete
 */
async function handleBatchDelete(
  env: DocumentApiEnv,
  collection: string,
  url: URL
): Promise<Response> {
  const queryParam = url.searchParams.get('query');

  let query: Record<string, unknown> = {};
  if (queryParam) {
    try {
      query = JSON.parse(queryParam) as Record<string, unknown>;
    } catch {
      return errorResponse('Invalid query parameter JSON', 400);
    }
  }

  try {
    const response = await forwardToDocumentDb(env, '/deleteMany', 'POST', {
      collection,
      query,
    });

    const result = await response.json() as { deletedCount?: number; error?: string };

    if (result.error) {
      return errorResponse(result.error, 500);
    }

    return jsonResponse({ deletedCount: result.deletedCount || 0 });
  } catch (error) {
    log.error('Batch delete error', { collection, error: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : 'Batch delete failed', 500);
  }
}

/**
 * Handle GET /docs - List all collections
 */
async function handleListCollections(env: DocumentApiEnv): Promise<Response> {
  try {
    const response = await forwardToDocumentDb(env, '/listCollections', 'GET');
    const result = await response.json() as { collections?: string[]; error?: string };

    if (result.error) {
      return errorResponse(result.error, 500);
    }

    return jsonResponse({ collections: result.collections || [] });
  } catch (error) {
    log.error('List collections error', { error: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : 'List collections failed', 500);
  }
}

/**
 * Handle DELETE /docs/:collection (with X-Drop-Collection header) - Drop collection
 */
async function handleDropCollection(
  env: DocumentApiEnv,
  collection: string
): Promise<Response> {
  try {
    const response = await forwardToDocumentDb(env, '/dropCollection', 'POST', {
      name: collection,
    });

    const result = await response.json() as { success?: boolean; error?: string };

    if (result.error) {
      return errorResponse(result.error, 500);
    }

    return noContentResponse();
  } catch (error) {
    log.error('Drop collection error', { collection, error: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : 'Drop collection failed', 500);
  }
}

/**
 * Handle CORS preflight requests
 */
function handleOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS_HEADERS,
      'Access-Control-Max-Age': '86400',
    },
  });
}

/**
 * Main request handler for the Document REST API
 *
 * Routes:
 * - OPTIONS * - CORS preflight
 * - GET /docs - List all collections
 * - POST /docs/:collection - Insert document
 * - GET /docs/:collection - Query documents
 * - GET /docs/:collection/:id - Get document by ID
 * - PUT /docs/:collection/:id - Update document
 * - DELETE /docs/:collection/:id - Delete document
 * - POST /docs/:collection/batch - Bulk insert
 * - DELETE /docs/:collection/batch - Bulk delete
 * - DELETE /docs/:collection (with X-Drop-Collection) - Drop collection
 */
export async function handleDocumentRequest(
  request: Request,
  env: DocumentApiEnv
): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return handleOptions();
  }

  // Check for DOCUMENT_DB_DO binding
  if (!env.DOCUMENT_DB_DO) {
    return errorResponse('Document database not configured', 500);
  }

  // Parse the path
  const parsed = parsePath(url.pathname);

  log.debug('Document API request', {
    method,
    path: url.pathname,
    collection: parsed.collection,
    documentId: parsed.documentId,
    isBatch: parsed.isBatch,
  });

  try {
    // Route: GET /docs - List all collections
    if (!parsed.collection && method === 'GET') {
      return handleListCollections(env);
    }

    // Route: POST /docs (without collection) - Invalid
    if (!parsed.collection && method === 'POST') {
      return errorResponse('Collection name is required for POST', 400);
    }

    // Validate collection name
    if (!parsed.collection) {
      return errorResponse('Collection name is required', 400);
    }

    // Route: Batch operations
    if (parsed.isBatch) {
      if (method === 'POST') {
        return handleBatchInsert(env, parsed.collection, request);
      }
      if (method === 'DELETE') {
        return handleBatchDelete(env, parsed.collection, url);
      }
      return errorResponse('Method not allowed for batch operations', 405);
    }

    // Route: Document operations
    if (parsed.documentId) {
      switch (method) {
        case 'GET':
          return handleGetById(env, parsed.collection, parsed.documentId);
        case 'PUT':
          return handleUpdate(env, parsed.collection, parsed.documentId, request);
        case 'DELETE':
          return handleDelete(env, parsed.collection, parsed.documentId);
        default:
          return errorResponse('Method not allowed', 405);
      }
    }

    // Route: Collection operations
    switch (method) {
      case 'POST':
        return handleInsert(env, parsed.collection, request);
      case 'GET':
        return handleQuery(env, parsed.collection, url);
      case 'DELETE':
        // Check for X-Drop-Collection header
        if (request.headers.get('X-Drop-Collection') === 'true') {
          return handleDropCollection(env, parsed.collection);
        }
        return errorResponse('DELETE on collection requires X-Drop-Collection header or document ID', 400);
      default:
        return errorResponse('Method not allowed', 405);
    }
  } catch (error) {
    log.error('Unexpected error in document API', {
      method,
      path: url.pathname,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error instanceof Error ? error.message : 'Internal server error', 500);
  }
}
