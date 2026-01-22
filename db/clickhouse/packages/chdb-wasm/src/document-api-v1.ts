/**
 * Document API v1 Handler
 *
 * REST API endpoints for document CRUD operations using SQL-based storage.
 * Uses DocumentQueryBuilder to convert MongoDB-style queries to ClickHouse SQL.
 *
 * Endpoints:
 * - POST /api/v1/collections/:name/docs - Insert document
 * - GET /api/v1/collections/:name/docs - List/Query documents
 * - GET /api/v1/collections/:name/docs/:id - Get document by ID
 * - PUT /api/v1/collections/:name/docs/:id - Update document (upsert)
 * - DELETE /api/v1/collections/:name/docs/:id - Delete document (soft delete)
 * - POST /api/v1/collections/:name/query - Query documents
 *
 * @module document-api-v1
 */

import { DocumentQueryBuilder, type FilterObject, type OrderDirection } from './query-builder';
import type { SqlExecutor } from './http-query-handler';
import { createLogger } from './utils/logger';

const log = createLogger('document-api-v1');

// =============================================================================
// Types
// =============================================================================

/**
 * CORS headers for cross-origin access
 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/**
 * Environment for the Document API v1 handler
 */
export interface DocumentApiV1Env {
  /**
   * Default database name
   */
  DEFAULT_DATABASE?: string;
}

/**
 * Parsed path information
 */
interface ParsedPath {
  collection: string;
  documentId?: string;
  isQuery?: boolean;
}

/**
 * Query request body
 */
interface QueryRequest {
  filter?: FilterObject;
  sort?: Record<string, OrderDirection>;
  limit?: number;
  skip?: number;
  fields?: string[];
}

/**
 * Insert response
 */
interface InsertResponse {
  id: string;
  success: boolean;
}

/**
 * Query response
 */
interface QueryResponse {
  documents: Record<string, unknown>[];
  count: number;
}

// =============================================================================
// Global SQL Executor
// =============================================================================

let sqlExecutor: SqlExecutor | null = null;

/**
 * Set the SQL executor to use for document operations
 */
export function setDocumentApiSqlExecutor(executor: SqlExecutor | null): void {
  sqlExecutor = executor;
}

/**
 * Get the current SQL executor
 */
function getExecutor(): SqlExecutor {
  if (!sqlExecutor) {
    throw new Error('No SQL executor configured. Call setDocumentApiSqlExecutor() to configure one.');
  }
  return sqlExecutor;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a JSON response with CORS headers
 */
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
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
 * Parse the URL path to extract collection and document ID
 * Expected format: /api/v1/collections/:name/docs[/:id]
 * or: /api/v1/collections/:name/query
 */
function parsePath(pathname: string): ParsedPath | null {
  // Match /api/v1/collections/:name/docs/:id
  const docsWithIdMatch = pathname.match(/^\/api\/v1\/collections\/([^/]+)\/docs\/([^/]+)$/);
  if (docsWithIdMatch) {
    return {
      collection: docsWithIdMatch[1],
      documentId: docsWithIdMatch[2],
    };
  }

  // Match /api/v1/collections/:name/docs
  const docsMatch = pathname.match(/^\/api\/v1\/collections\/([^/]+)\/docs$/);
  if (docsMatch) {
    return {
      collection: docsMatch[1],
    };
  }

  // Match /api/v1/collections/:name/query
  const queryMatch = pathname.match(/^\/api\/v1\/collections\/([^/]+)\/query$/);
  if (queryMatch) {
    return {
      collection: queryMatch[1],
      isQuery: true,
    };
  }

  return null;
}

/**
 * Parse JSON body safely
 */
async function parseJsonBody<T>(request: Request): Promise<T | null> {
  try {
    const text = await request.text();
    if (!text || text.trim() === '') {
      return null;
    }
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * Generate a unique document ID (ObjectId-style)
 */
function generateObjectId(): string {
  const timestamp = Math.floor(Date.now() / 1000).toString(16).padStart(8, '0');
  const random = Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('');
  return timestamp + random;
}

/**
 * Validate collection name
 */
function validateCollectionName(name: string): boolean {
  const pattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
  return pattern.test(name) && name.length >= 1 && name.length <= 64;
}

// =============================================================================
// Request Handlers
// =============================================================================

/**
 * Handle POST /api/v1/collections/:name/docs - Insert document
 */
async function handleInsertDocument(
  collection: string,
  request: Request,
  database: string
): Promise<Response> {
  const body = await parseJsonBody<Record<string, unknown>>(request);
  if (!body) {
    return errorResponse('Invalid or empty JSON body', 400);
  }

  try {
    const executor = getExecutor();
    const builder = new DocumentQueryBuilder({ collection, database });

    // Generate ID if not provided
    const id = (body._id as string) || generateObjectId();

    // Remove _id from the data to store
    const { _id: _, ...documentData } = body;

    // Build and execute the insert
    const sql = builder.buildInsert(documentData, { id });
    log.debug('Insert document SQL', { sql, collection, id });

    await executor.execute(sql);

    const response: InsertResponse = {
      id,
      success: true,
    };

    return jsonResponse(response, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('Insert document error', { collection, error: message });
    return errorResponse(message, 500);
  }
}

/**
 * Handle GET /api/v1/collections/:name/docs/:id - Get document by ID
 */
async function handleGetDocument(
  collection: string,
  documentId: string,
  database: string
): Promise<Response> {
  try {
    const executor = getExecutor();
    const builder = new DocumentQueryBuilder({ collection, database });

    const sql = builder
      .whereId(documentId)
      .notDeleted()
      .limit(1)
      .build();

    log.debug('Get document SQL', { sql, collection, documentId });

    const result = await executor.execute(sql);

    if (!result.data || result.data.length === 0) {
      return errorResponse('Document not found', 404);
    }

    const row = result.data[0] as Record<string, unknown>;

    // Parse the data JSON field if it exists
    let document: Record<string, unknown> = { _id: row.id };
    if (row.data && typeof row.data === 'string') {
      try {
        document = { _id: row.id, ...JSON.parse(row.data) };
      } catch {
        document = { _id: row.id, data: row.data };
      }
    } else if (row.data && typeof row.data === 'object') {
      document = { _id: row.id, ...(row.data as Record<string, unknown>) };
    }

    return jsonResponse(document);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('Get document error', { collection, documentId, error: message });
    return errorResponse(message, 500);
  }
}

/**
 * Handle PUT /api/v1/collections/:name/docs/:id - Update document (upsert)
 */
async function handleUpdateDocument(
  collection: string,
  documentId: string,
  request: Request,
  database: string
): Promise<Response> {
  const body = await parseJsonBody<Record<string, unknown>>(request);
  if (!body) {
    return errorResponse('Invalid or empty JSON body', 400);
  }

  try {
    const executor = getExecutor();
    const builder = new DocumentQueryBuilder({ collection, database });

    // Remove _id from the update data
    const { _id: _, ...updateData } = body;

    // Build and execute the upsert
    const sql = builder.buildUpsert(documentId, updateData);
    log.debug('Update document SQL', { sql, collection, documentId });

    await executor.execute(sql);

    return jsonResponse({ success: true, id: documentId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('Update document error', { collection, documentId, error: message });
    return errorResponse(message, 500);
  }
}

/**
 * Handle DELETE /api/v1/collections/:name/docs/:id - Delete document (soft delete)
 */
async function handleDeleteDocument(
  collection: string,
  documentId: string,
  database: string
): Promise<Response> {
  try {
    const executor = getExecutor();
    const builder = new DocumentQueryBuilder({ collection, database });

    // Build and execute the soft delete
    const sql = builder.buildSoftDelete(documentId);
    log.debug('Delete document SQL', { sql, collection, documentId });

    await executor.execute(sql);

    return noContentResponse();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('Delete document error', { collection, documentId, error: message });
    return errorResponse(message, 500);
  }
}

/**
 * Handle GET /api/v1/collections/:name/docs - List/Query documents via GET
 */
async function handleListDocuments(
  collection: string,
  url: URL,
  database: string
): Promise<Response> {
  try {
    const executor = getExecutor();
    const builder = new DocumentQueryBuilder({ collection, database });

    // Parse query parameters
    const filterParam = url.searchParams.get('filter');
    const sortParam = url.searchParams.get('sort');
    const limitParam = url.searchParams.get('limit');
    const skipParam = url.searchParams.get('skip');

    // Apply filter if provided
    if (filterParam) {
      try {
        const filter = JSON.parse(filterParam) as FilterObject;
        builder.filter(filter);
      } catch {
        return errorResponse('Invalid filter parameter: must be valid JSON', 400);
      }
    }

    // Exclude deleted documents by default
    builder.notDeleted();

    // Apply sort if provided
    if (sortParam) {
      try {
        const sort = JSON.parse(sortParam) as Record<string, OrderDirection>;
        for (const [field, direction] of Object.entries(sort)) {
          builder.orderBy(field, direction);
        }
      } catch {
        return errorResponse('Invalid sort parameter: must be valid JSON', 400);
      }
    }

    // Apply pagination
    if (limitParam) {
      const limit = parseInt(limitParam, 10);
      if (isNaN(limit) || limit < 0) {
        return errorResponse('Invalid limit parameter: must be a non-negative integer', 400);
      }
      builder.limit(limit);
    }
    if (skipParam) {
      const skip = parseInt(skipParam, 10);
      if (isNaN(skip) || skip < 0) {
        return errorResponse('Invalid skip parameter: must be a non-negative integer', 400);
      }
      builder.skip(skip);
    }

    const sql = builder.build();
    log.debug('List documents SQL', { sql, collection });

    const result = await executor.execute(sql);

    // Parse the documents
    const documents = (result.data || []).map((row: Record<string, unknown>) => {
      let document: Record<string, unknown> = { _id: row.id };
      if (row.data && typeof row.data === 'string') {
        try {
          document = { _id: row.id, ...JSON.parse(row.data) };
        } catch {
          document = { _id: row.id, data: row.data };
        }
      } else if (row.data && typeof row.data === 'object') {
        document = { _id: row.id, ...(row.data as Record<string, unknown>) };
      }
      return document;
    });

    const response: QueryResponse = {
      documents,
      count: documents.length,
    };

    return jsonResponse(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('List documents error', { collection, error: message });
    return errorResponse(message, 500);
  }
}

/**
 * Handle POST /api/v1/collections/:name/query - Query documents
 */
async function handleQueryDocuments(
  collection: string,
  request: Request,
  database: string
): Promise<Response> {
  const body = await parseJsonBody<QueryRequest>(request);
  const queryParams = body || {};

  try {
    const executor = getExecutor();
    const builder = new DocumentQueryBuilder({ collection, database });

    // Apply filter if provided
    if (queryParams.filter) {
      builder.filter(queryParams.filter);
    }

    // Exclude deleted documents by default
    builder.notDeleted();

    // Apply sort if provided
    if (queryParams.sort) {
      for (const [field, direction] of Object.entries(queryParams.sort)) {
        builder.orderBy(field, direction);
      }
    }

    // Apply field selection if provided
    if (queryParams.fields && queryParams.fields.length > 0) {
      builder.select(...queryParams.fields);
    }

    // Apply pagination
    if (queryParams.limit !== undefined) {
      builder.limit(queryParams.limit);
    }
    if (queryParams.skip !== undefined) {
      builder.skip(queryParams.skip);
    }

    const sql = builder.build();
    log.debug('Query documents SQL', { sql, collection, queryParams });

    const result = await executor.execute(sql);

    // Parse the documents
    const documents = (result.data || []).map((row: Record<string, unknown>) => {
      let document: Record<string, unknown> = { _id: row.id };
      if (row.data && typeof row.data === 'string') {
        try {
          document = { _id: row.id, ...JSON.parse(row.data) };
        } catch {
          document = { _id: row.id, data: row.data };
        }
      } else if (row.data && typeof row.data === 'object') {
        document = { _id: row.id, ...(row.data as Record<string, unknown>) };
      }
      return document;
    });

    const response: QueryResponse = {
      documents,
      count: documents.length,
    };

    return jsonResponse(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('Query documents error', { collection, error: message });
    return errorResponse(message, 500);
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

// =============================================================================
// Main Handler
// =============================================================================

/**
 * Main request handler for Document API v1
 *
 * Routes:
 * - OPTIONS * - CORS preflight
 * - POST /api/v1/collections/:name/docs - Insert document
 * - GET /api/v1/collections/:name/docs - List/Query documents
 * - GET /api/v1/collections/:name/docs/:id - Get document by ID
 * - PUT /api/v1/collections/:name/docs/:id - Update document (upsert)
 * - DELETE /api/v1/collections/:name/docs/:id - Delete document (soft delete)
 * - POST /api/v1/collections/:name/query - Query documents
 */
export async function handleDocumentApiV1Request(
  request: Request,
  env: DocumentApiV1Env
): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const database = env.DEFAULT_DATABASE || 'default';

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return handleOptions();
  }

  // Parse the path
  const parsed = parsePath(url.pathname);

  if (!parsed) {
    return errorResponse('Not found', 404);
  }

  // Validate collection name
  if (!validateCollectionName(parsed.collection)) {
    return errorResponse('Invalid collection name', 400);
  }

  log.debug('Document API v1 request', {
    method,
    path: url.pathname,
    collection: parsed.collection,
    documentId: parsed.documentId,
    isQuery: parsed.isQuery,
  });

  try {
    // Handle query endpoint
    if (parsed.isQuery) {
      if (method === 'POST') {
        return handleQueryDocuments(parsed.collection, request, database);
      }
      return errorResponse('Method not allowed', 405);
    }

    // Handle document operations with ID
    if (parsed.documentId) {
      switch (method) {
        case 'GET':
          return handleGetDocument(parsed.collection, parsed.documentId, database);
        case 'PUT':
          return handleUpdateDocument(parsed.collection, parsed.documentId, request, database);
        case 'DELETE':
          return handleDeleteDocument(parsed.collection, parsed.documentId, database);
        default:
          return errorResponse('Method not allowed', 405);
      }
    }

    // Handle collection-level operations
    switch (method) {
      case 'POST':
        return handleInsertDocument(parsed.collection, request, database);
      case 'GET':
        return handleListDocuments(parsed.collection, url, database);
      default:
        return errorResponse('Method not allowed', 405);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('Document API v1 error', {
      method,
      path: url.pathname,
      error: message,
    });
    return errorResponse(message, 500);
  }
}
