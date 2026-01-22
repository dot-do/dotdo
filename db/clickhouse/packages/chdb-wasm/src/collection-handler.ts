/**
 * Collections API Handler
 *
 * Provides REST API for managing document collections (tables).
 * Collections are backed by ClickHouse ReplacingMergeTree tables for
 * efficient document storage with automatic deduplication.
 *
 * Endpoints:
 * - POST /collections - Create a new collection
 * - GET /collections - List all collections
 * - GET /collections/:name - Get collection info
 * - DELETE /collections/:name - Drop a collection
 *
 * Table Schema:
 * ```sql
 * CREATE TABLE {name} (
 *   id String,
 *   _version UInt64 DEFAULT now64(),
 *   data String,
 *   created_at DateTime64(3) DEFAULT now64(),
 *   updated_at DateTime64(3) DEFAULT now64()
 * ) ENGINE = ReplacingMergeTree(_version)
 * ORDER BY id
 * ```
 *
 * @module collection-handler
 */

import type { SqlExecutor, DurableObjectNamespace, R2Bucket } from './http-query-handler';

// =============================================================================
// Types
// =============================================================================

/**
 * Environment for the collections handler
 */
export interface CollectionHandlerEnv {
  /**
   * Optional: Durable Object binding for Document DB
   */
  DOCUMENT_DB_DO?: DurableObjectNamespace;

  /**
   * Optional: R2 bucket for data storage
   */
  DATA_BUCKET?: R2Bucket;

  /**
   * Optional: Default database name
   */
  DEFAULT_DATABASE?: string;
}

/**
 * Collection metadata returned by the API
 */
export interface CollectionInfo {
  name: string;
  database: string;
  engine: string;
  total_rows: number;
  total_bytes: number;
  created_at: string;
  schema: {
    columns: Array<{
      name: string;
      type: string;
      default_expression?: string;
    }>;
  };
}

/**
 * Options for creating a collection
 */
export interface CreateCollectionOptions {
  /**
   * Collection name (required)
   */
  name: string;

  /**
   * Database to create the collection in (optional, defaults to 'default')
   */
  database?: string;

  /**
   * Additional settings for the collection
   */
  settings?: {
    /**
     * Time-to-live in seconds (optional)
     */
    ttl?: number;

    /**
     * Custom partition key expression (optional)
     */
    partitionBy?: string;

    /**
     * Index granularity (optional, default 8192)
     */
    indexGranularity?: number;
  };
}

/**
 * Response for collection creation
 */
export interface CreateCollectionResponse {
  success: boolean;
  name: string;
  database: string;
  message: string;
}

/**
 * Response for listing collections
 */
export interface ListCollectionsResponse {
  collections: Array<{
    name: string;
    database: string;
    total_rows: number;
    total_bytes: number;
  }>;
  count: number;
}

/**
 * Response for dropping a collection
 */
export interface DropCollectionResponse {
  success: boolean;
  name: string;
  database: string;
  message: string;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * CORS headers for cross-origin access
 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-ClickHouse-Format',
};

/**
 * Default database name
 */
const DEFAULT_DATABASE = 'default';

/**
 * Reserved collection names that cannot be used
 */
const RESERVED_NAMES = new Set([
  'system',
  'information_schema',
  '_internal',
  '__collections',
]);

/**
 * Regex pattern for valid collection names
 */
const VALID_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

// =============================================================================
// Global SQL Executor
// =============================================================================

let sqlExecutor: SqlExecutor | null = null;

/**
 * Set the SQL executor to use for collection operations
 */
export function setCollectionSqlExecutor(executor: SqlExecutor | null): void {
  sqlExecutor = executor;
}

/**
 * Get the current SQL executor
 */
function getExecutor(): SqlExecutor {
  if (!sqlExecutor) {
    throw new Error('No SQL executor configured. Call setCollectionSqlExecutor() to configure one.');
  }
  return sqlExecutor;
}

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Validate collection name
 */
function validateCollectionName(name: string): void {
  if (!name || typeof name !== 'string') {
    throw new Error('Collection name is required');
  }

  if (name.length < 1 || name.length > 64) {
    throw new Error('Collection name must be between 1 and 64 characters');
  }

  if (!VALID_NAME_PATTERN.test(name)) {
    throw new Error('Collection name must start with a letter or underscore and contain only letters, numbers, and underscores');
  }

  if (RESERVED_NAMES.has(name.toLowerCase())) {
    throw new Error(`Collection name "${name}" is reserved`);
  }
}

/**
 * Validate database name
 */
function validateDatabaseName(name: string): void {
  if (!VALID_NAME_PATTERN.test(name)) {
    throw new Error('Database name must start with a letter or underscore and contain only letters, numbers, and underscores');
  }
}

/**
 * Escape identifier for SQL
 */
function escapeIdentifier(name: string): string {
  // Use backticks for identifiers and escape any backticks within
  return '`' + name.replace(/`/g, '``') + '`';
}

// =============================================================================
// Collection Operations
// =============================================================================

/**
 * Generate CREATE TABLE SQL for a collection
 */
function generateCreateTableSql(options: CreateCollectionOptions): string {
  const database = options.database || DEFAULT_DATABASE;
  const tableName = `${escapeIdentifier(database)}.${escapeIdentifier(options.name)}`;

  const settings = options.settings || {};
  const indexGranularity = settings.indexGranularity || 8192;

  let sql = `CREATE TABLE IF NOT EXISTS ${tableName} (
  id String,
  _version UInt64 DEFAULT toUnixTimestamp64Milli(now64()),
  data String,
  created_at DateTime64(3) DEFAULT now64(),
  updated_at DateTime64(3) DEFAULT now64(),
  _deleted UInt8 DEFAULT 0
) ENGINE = ReplacingMergeTree(_version, _deleted)`;

  // Add partition by clause if specified
  if (settings.partitionBy) {
    sql += `\nPARTITION BY ${settings.partitionBy}`;
  }

  sql += `\nORDER BY id`;
  sql += `\nSETTINGS index_granularity = ${indexGranularity}`;

  // Add TTL if specified
  if (settings.ttl && settings.ttl > 0) {
    sql += `\nTTL created_at + INTERVAL ${settings.ttl} SECOND`;
  }

  return sql;
}

/**
 * Create a new collection
 */
export async function createCollection(options: CreateCollectionOptions): Promise<CreateCollectionResponse> {
  validateCollectionName(options.name);

  const database = options.database || DEFAULT_DATABASE;
  if (database !== DEFAULT_DATABASE) {
    validateDatabaseName(database);
  }

  const executor = getExecutor();

  // Generate and execute CREATE TABLE
  const createSql = generateCreateTableSql(options);
  await executor.execute(createSql);

  return {
    success: true,
    name: options.name,
    database,
    message: `Collection "${options.name}" created successfully`,
  };
}

/**
 * List all collections
 */
export async function listCollections(database?: string): Promise<ListCollectionsResponse> {
  const executor = getExecutor();
  const db = database || DEFAULT_DATABASE;

  // Query system tables to list all tables that look like collections
  // (have our expected schema structure)
  const sql = `
    SELECT
      name,
      database,
      total_rows,
      total_bytes
    FROM system.tables
    WHERE database = '${db}'
      AND engine LIKE '%MergeTree%'
      AND has(splitByChar(',', create_table_query), 'id String')
    ORDER BY name
  `;

  try {
    const result = await executor.execute(sql);

    const collections = result.data.map((row: Record<string, unknown>) => ({
      name: String(row.name || ''),
      database: String(row.database || db),
      total_rows: Number(row.total_rows || 0),
      total_bytes: Number(row.total_bytes || 0),
    }));

    return {
      collections,
      count: collections.length,
    };
  } catch {
    // If system tables are not available, return empty list
    return {
      collections: [],
      count: 0,
    };
  }
}

/**
 * Get information about a specific collection
 */
export async function getCollectionInfo(name: string, database?: string): Promise<CollectionInfo | null> {
  validateCollectionName(name);

  const executor = getExecutor();
  const db = database || DEFAULT_DATABASE;

  // Query system tables for table info
  const tableSql = `
    SELECT
      name,
      database,
      engine,
      total_rows,
      total_bytes,
      metadata_modification_time as created_at
    FROM system.tables
    WHERE database = '${db}'
      AND name = '${name}'
    LIMIT 1
  `;

  try {
    const tableResult = await executor.execute(tableSql);

    if (tableResult.data.length === 0) {
      return null;
    }

    const tableRow = tableResult.data[0] as Record<string, unknown>;

    // Query columns
    const columnsSql = `
      SELECT
        name,
        type,
        default_expression
      FROM system.columns
      WHERE database = '${db}'
        AND table = '${name}'
      ORDER BY position
    `;

    const columnsResult = await executor.execute(columnsSql);

    const columns = columnsResult.data.map((row: Record<string, unknown>) => ({
      name: String(row.name || ''),
      type: String(row.type || ''),
      default_expression: row.default_expression ? String(row.default_expression) : undefined,
    }));

    return {
      name: String(tableRow.name || name),
      database: String(tableRow.database || db),
      engine: String(tableRow.engine || 'ReplacingMergeTree'),
      total_rows: Number(tableRow.total_rows || 0),
      total_bytes: Number(tableRow.total_bytes || 0),
      created_at: String(tableRow.created_at || new Date().toISOString()),
      schema: {
        columns,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Drop a collection
 */
export async function dropCollection(name: string, database?: string): Promise<DropCollectionResponse> {
  validateCollectionName(name);

  const executor = getExecutor();
  const db = database || DEFAULT_DATABASE;

  const tableName = `${escapeIdentifier(db)}.${escapeIdentifier(name)}`;
  const sql = `DROP TABLE IF EXISTS ${tableName}`;

  await executor.execute(sql);

  return {
    success: true,
    name,
    database: db,
    message: `Collection "${name}" dropped successfully`,
  };
}

// =============================================================================
// HTTP Handler
// =============================================================================

/**
 * Create JSON response with CORS headers
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
 * Create error response
 */
function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

/**
 * Handle POST /collections - Create a new collection
 */
async function handleCreateCollection(request: Request): Promise<Response> {
  try {
    const body = await request.json() as CreateCollectionOptions;

    if (!body.name) {
      return errorResponse('Missing required field: name', 400);
    }

    const result = await createCollection(body);
    return jsonResponse(result, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(message, 400);
  }
}

/**
 * Handle GET /collections - List all collections
 */
async function handleListCollections(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const database = url.searchParams.get('database') || undefined;

    const result = await listCollections(database);
    return jsonResponse(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(message, 500);
  }
}

/**
 * Handle GET /collections/:name - Get collection info
 */
async function handleGetCollection(collectionName: string, request: Request): Promise<Response> {
  try {
    // Validate collection name first - return 400 for invalid names
    validateCollectionName(collectionName);

    const url = new URL(request.url);
    const database = url.searchParams.get('database') || undefined;

    const result = await getCollectionInfo(collectionName, database);

    if (!result) {
      return errorResponse(`Collection "${collectionName}" not found`, 404);
    }

    return jsonResponse(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Return 400 for validation errors, 500 for other errors
    const isValidationError = message.includes('must start with') ||
      message.includes('reserved') ||
      message.includes('required') ||
      message.includes('must be between');
    return errorResponse(message, isValidationError ? 400 : 500);
  }
}

/**
 * Handle DELETE /collections/:name - Drop a collection
 */
async function handleDropCollection(collectionName: string, request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const database = url.searchParams.get('database') || undefined;

    const result = await dropCollection(collectionName, database);
    return jsonResponse(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(message, 400);
  }
}

/**
 * Handle OPTIONS requests for CORS preflight
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
 * Main collections request handler
 *
 * Routes:
 * - OPTIONS /api/v1/collections/* - CORS preflight
 * - POST /api/v1/collections - Create collection
 * - GET /api/v1/collections - List collections
 * - GET /api/v1/collections/:name - Get collection info
 * - DELETE /api/v1/collections/:name - Drop collection
 */
export async function handleCollectionsRequest(
  request: Request,
  _env: CollectionHandlerEnv
): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const path = url.pathname;

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return handleOptions();
  }

  // Parse the path to extract collection name
  // /api/v1/collections -> list or create
  // /api/v1/collections/:name -> get or delete

  const collectionsMatch = path.match(/^\/api\/v1\/collections(?:\/(.+))?$/);

  if (!collectionsMatch) {
    return errorResponse('Not found', 404);
  }

  const collectionName = collectionsMatch[1];

  // Routes without collection name
  if (!collectionName) {
    if (method === 'POST') {
      return handleCreateCollection(request);
    }
    if (method === 'GET') {
      return handleListCollections(request);
    }
    return errorResponse('Method not allowed', 405);
  }

  // Routes with collection name
  if (method === 'GET') {
    return handleGetCollection(collectionName, request);
  }
  if (method === 'DELETE') {
    return handleDropCollection(collectionName, request);
  }

  return errorResponse('Method not allowed', 405);
}
