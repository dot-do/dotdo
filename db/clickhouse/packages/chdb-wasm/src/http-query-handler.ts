/**
 * ClickHouse-compatible HTTP Query Handler
 *
 * Implements the ClickHouse HTTP interface for query execution:
 * - GET /?query=SELECT+1 returns '1\n' (TabSeparated format by default)
 * - GET /?query=SELECT+1&default_format=JSON returns JSON
 * - GET /?query=SELECT+1&default_format=JSONEachRow returns {"1":1}
 * - Query params: database, user, password, query_id, max_result_rows, etc.
 *
 * This module is a THIN wrapper that passes queries to the WASM executor.
 * It does NOT reimplement SQL in JavaScript.
 *
 * @see https://clickhouse.com/docs/en/interfaces/http
 */

// Import formatters module for output formatting
import {
  formatResult as formatQueryResult,
  getContentType as _getFormatContentType,
  detectFormat as _detectOutputFormat,
  FORMAT_CONTENT_TYPES as FORMATTER_CONTENT_TYPES,
  type QueryResult as FormatterQueryResult,
} from './formatters';

// Import S3/URL table function module for URL parsing and validation
import {
  parseS3Url,
  parseS3FunctionArgs,
  parseUrlFunctionArgs,
  validateS3Args,
  validateUrlArgs,
  detectFormatFromUrl,
  getVirtualColumnsFromUrl,
  S3TableFunctionError,
  UrlTableFunctionError,
  type S3UrlParts,
  type S3FunctionArgs,
  type UrlFunctionArgs,
  type S3SupportedFormat,
} from './table-functions/s3';

// Re-export S3 module types and functions for consumers
export {
  parseS3Url,
  parseS3FunctionArgs,
  parseUrlFunctionArgs,
  validateS3Args,
  validateUrlArgs,
  detectFormatFromUrl,
  getVirtualColumnsFromUrl,
  S3TableFunctionError,
  UrlTableFunctionError,
  type S3UrlParts,
  type S3FunctionArgs,
  type UrlFunctionArgs,
  type S3SupportedFormat,
};

// Import shared types for proper typing
import type { RowData, ColumnMeta, QueryStatistics } from './types';

/**
 * SQL Executor interface - the core abstraction for executing queries
 */
export interface SqlExecutor {
  execute: (sql: string) => Promise<{ meta: ColumnMeta[]; data: RowData[]; rows: number; statistics?: QueryStatistics }>;
}

/**
 * Durable Object namespace interface (from Cloudflare Workers)
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
 * R2 Bucket interface (from Cloudflare Workers)
 */
export interface R2Bucket {
  get(key: string, options?: { range?: { offset?: number; length?: number } }): Promise<R2Object | null>;
  head(key: string): Promise<{ size: number; etag?: string } | null>;
  put(key: string, value: ArrayBuffer | string): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number }): Promise<{ objects: R2Object[] }>;
}

export interface R2Object {
  key: string;
  size: number;
  etag?: string;
  httpEtag?: string;
  uploaded?: Date;
  body?: ReadableStream<Uint8Array>;
  arrayBuffer(): Promise<ArrayBuffer>;
  text?(): Promise<string>;
}

/**
 * Environment for the HTTP query handler
 */
export interface HttpQueryEnv {
  /**
   * The chdb instance used for query execution
   */
  chdb: {
    query: (sql: string, options?: { format?: string }) => Promise<string>;
  };

  /**
   * Optional: Durable Object binding for Memory engine tables
   */
  MEMORY_ENGINE_DO?: DurableObjectNamespace;

  /**
   * Optional: Durable Object binding for MergeTree tables
   */
  MERGETREE_DO?: DurableObjectNamespace;

  /**
   * Optional: R2 bucket for MergeTree data storage (L3 tiering)
   */
  DATA_BUCKET?: R2Bucket;

  /**
   * Optional: Default database name
   */
  DEFAULT_DATABASE?: string;
}

/**
 * Content types for each format
 * Re-exported from formatters module for backward compatibility
 */
const FORMAT_CONTENT_TYPES = FORMATTER_CONTENT_TYPES;

/**
 * CORS headers for cross-origin access
 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-ClickHouse-Format, X-ClickHouse-User, X-ClickHouse-Key',
};

/**
 * Server display name header
 */
const SERVER_DISPLAY_NAME = 'chdb-wasm';

/**
 * Server start time for uptime calculation
 */
const SERVER_START_TIME = Date.now();

// ============================================================================
// SQL Executor Configuration
// ============================================================================

/**
 * Global SQL executor instance (set via setSqlExecutor)
 */
let sqlExecutor: SqlExecutor | null = null;

/**
 * Set the SQL executor to use
 */
export function setSqlExecutor(executor: SqlExecutor | null): void {
  sqlExecutor = executor;
}

// ============================================================================
// Request Context (Per-Request Isolation)
// ============================================================================

/**
 * Request context for per-request state isolation.
 */
export interface RequestContext {
  requestId: string;
  env: HttpQueryEnv;
  startTime: number;
}

/**
 * WeakMap to associate Request objects with their context.
 */
const requestContexts = new WeakMap<Request, RequestContext>();

/**
 * Current request being processed (for backward compatibility).
 */
let currentRequest: Request | null = null;
let currentEnv: HttpQueryEnv | null = null;

/**
 * Create a new request context
 */
function createRequestContext(request: Request, env: HttpQueryEnv, requestId: string): RequestContext {
  const ctx: RequestContext = { requestId, env, startTime: Date.now() };
  requestContexts.set(request, ctx);
  return ctx;
}

/**
 * Get the context for a request
 */
export function getRequestContext(request: Request): RequestContext | undefined {
  return requestContexts.get(request);
}

/**
 * Clean up request context when request completes
 */
function cleanupRequestContext(request: Request): void {
  requestContexts.delete(request);
}

/**
 * Set the current request (for backward compatibility)
 */
function setCurrentRequest(request: Request, env: HttpQueryEnv): void {
  currentRequest = request;
  currentEnv = env;
}

/**
 * Clear the current request
 */
function clearCurrentRequest(): void {
  currentRequest = null;
  currentEnv = null;
}

/**
 * Get the current request (for backward compatibility)
 */
export function _getCurrentRequest(): Request | null {
  return currentRequest;
}

/**
 * Get the current environment (for backward compatibility)
 */
export function _getCurrentEnv(): HttpQueryEnv | null {
  return currentEnv;
}

// ============================================================================
// Query Execution
// ============================================================================

/**
 * Get or create a SQL executor
 */
function getExecutor(): SqlExecutor {
  if (sqlExecutor) {
    return sqlExecutor;
  }

  // Default executor that throws - should be configured by the worker
  return {
    async execute(_sql: string): Promise<{ meta: ColumnMeta[]; data: RowData[]; rows: number; statistics?: QueryStatistics }> {
      throw new Error('No SQL executor configured. Call setSqlExecutor() to configure one.');
    }
  };
}

/**
 * Generate a unique query ID
 */
function generateQueryId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Extract FORMAT clause from SQL and return cleaned SQL with format
 */
function extractFormatFromSql(sql: string): { sql: string; format: string | null } {
  const trimmedSql = sql.trim();
  const formatMatch = trimmedSql.match(/\bFORMAT\s+(\w+)\s*$/i);

  if (formatMatch) {
    const cleanSql = trimmedSql.replace(/\bFORMAT\s+\w+\s*$/i, '').trim();
    return { sql: cleanSql, format: formatMatch[1] };
  }

  return { sql: trimmedSql, format: null };
}

/**
 * Apply query parameters (param_name=value) to SQL with typed placeholders
 */
function applyParams(sql: string, params: Map<string, string>): string {
  let result = sql;

  for (const [key, value] of params) {
    // Find typed placeholders like {name:String} or {name:UInt32}
    const regex = new RegExp(`\\{${key}:\\w+\\}`, 'g');

    // Determine if the value should be quoted
    const isNumeric = /^-?\d+(\.\d+)?$/.test(value);
    const formattedValue = isNumeric ? value : `'${value.replace(/'/g, "''")}'`;

    result = result.replace(regex, formattedValue);
  }

  return result;
}

/**
 * Format the result based on the requested format
 * Delegates to the formatters module for actual formatting.
 */
function formatResult(jsonResult: string, format: string): string {
  // Parse the JSON result
  let parsed: FormatterQueryResult;

  try {
    parsed = JSON.parse(jsonResult);
  } catch {
    // If it's not JSON, return as-is
    return jsonResult;
  }

  // Use the formatters module for actual formatting
  return formatQueryResult(parsed, format);
}

/**
 * Execute a query and return formatted result
 */
async function executeQueryInternal(
  sql: string,
  format: string,
  params: Map<string, string>,
  options: { maxResultRows?: number; resultOverflowMode?: string }
): Promise<{ result: string; rowsRead: number; bytesRead: number }> {
  const executor = getExecutor();

  // Apply parameters to SQL
  let processedSql = applyParams(sql, params);

  // Apply max_result_rows limit if specified
  if (options.maxResultRows && options.maxResultRows > 0) {
    // Check if query already has LIMIT
    if (!/\bLIMIT\s+\d+/i.test(processedSql)) {
      processedSql = `${processedSql} LIMIT ${options.maxResultRows + 1}`;
    }
  }

  // Execute query via the WASM executor
  const parsed = await executor.execute(processedSql);

  // Check result overflow
  if (options.maxResultRows && options.resultOverflowMode === 'throw') {
    if (parsed.data.length > options.maxResultRows) {
      throw new Error(`TOO_MANY_ROWS: Result has more than ${options.maxResultRows} rows`);
    }
  }

  // Trim extra row if we added one for overflow check
  if (options.maxResultRows && parsed.data.length > options.maxResultRows) {
    parsed.data = parsed.data.slice(0, options.maxResultRows);
    parsed.rows = parsed.data.length;
  }

  // Format the result
  const formattedResult = formatResult(JSON.stringify(parsed), format);

  return {
    result: formattedResult,
    rowsRead: parsed.rows,
    bytesRead: formattedResult.length,
  };
}

/**
 * Create error response with proper headers
 * If format is JSON, returns JSON-formatted error
 */
function createErrorResponse(
  message: string,
  status: number,
  queryId: string,
  format?: string
): Response {
  // Format error based on output format
  let body: string;
  let contentType: string;

  if (format?.toUpperCase().startsWith('JSON')) {
    body = JSON.stringify({
      exception: message,
      rows: 0,
      meta: [],
      data: [],
    });
    contentType = 'application/json; charset=UTF-8';
  } else {
    body = message;
    contentType = 'text/plain; charset=UTF-8';
  }

  return new Response(body, {
    status,
    headers: {
      'Content-Type': contentType,
      'X-ClickHouse-Query-Id': queryId,
      'X-ClickHouse-Server-Display-Name': SERVER_DISPLAY_NAME,
      ...CORS_HEADERS,
    },
  });
}

// ============================================================================
// Main HTTP Query Handler
// ============================================================================

/**
 * Handle an HTTP query request
 *
 * This is the main entry point for the ClickHouse HTTP interface.
 * It handles:
 * - GET /?query=... - query in URL parameter
 * - POST / with query in body
 * - /ping endpoint
 * - /replicas_status endpoint
 * - /health, /health/ready, /health/live endpoints
 */
export async function handleHttpQuery(
  request: Request,
  _env: HttpQueryEnv
): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  // Generate query ID for tracking
  const queryId = url.searchParams.get('query_id') || generateQueryId();

  // Handle /ping endpoint (returns "Ok.\n")
  if (url.pathname === '/ping') {
    return new Response('Ok.\n', {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=UTF-8',
        ...CORS_HEADERS,
      },
    });
  }

  // Handle /replicas_status endpoint
  if (url.pathname === '/replicas_status') {
    return new Response('Ok.\n', {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=UTF-8',
        ...CORS_HEADERS,
      },
    });
  }

  // Handle health endpoints (/health, /health/ready, /health/live)
  if (url.pathname === '/health' || url.pathname === '/health/ready' || url.pathname === '/health/live') {
    // Handle OPTIONS for CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...CORS_HEADERS,
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Only allow GET for health endpoints
    if (method !== 'GET') {
      return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
        status: 405,
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'Allow': 'GET, OPTIONS',
          ...CORS_HEADERS,
        },
      });
    }

    // Handle specific health endpoints
    if (url.pathname === '/health') {
      const uptimeSeconds = Math.floor((Date.now() - SERVER_START_TIME) / 1000);
      return new Response(JSON.stringify({
        status: 'ok',
        version: '1.0.0',
        uptime: uptimeSeconds,
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          ...CORS_HEADERS,
        },
      });
    }

    if (url.pathname === '/health/ready') {
      return new Response(JSON.stringify({ ready: true }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          ...CORS_HEADERS,
        },
      });
    }

    if (url.pathname === '/health/live') {
      return new Response(JSON.stringify({ alive: true }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          ...CORS_HEADERS,
        },
      });
    }
  }

  // Handle OPTIONS for CORS preflight
  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...CORS_HEADERS,
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  // Only allow GET and POST for queries
  if (method !== 'GET' && method !== 'POST') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: {
        'Allow': 'GET, POST, OPTIONS',
        ...CORS_HEADERS,
      },
    });
  }

  // Get query from URL params or body
  let sql = url.searchParams.get('query') || '';

  // For POST requests, get query from body if not in URL
  if (method === 'POST' && !sql) {
    sql = await request.text();
  }

  // Check for empty query
  if (!sql || sql.trim() === '') {
    return createErrorResponse(
      'Missing query parameter or empty request body',
      400,
      queryId
    );
  }

  // Determine output format (priority: FORMAT in SQL > X-ClickHouse-Format header > default_format param > TabSeparated)
  const { sql: cleanSql, format: sqlFormat } = extractFormatFromSql(sql);
  const headerFormat = request.headers.get('X-ClickHouse-Format');
  const paramFormat = url.searchParams.get('default_format');
  const format = sqlFormat || headerFormat || paramFormat || 'TabSeparated';

  // Collect parameters (param_name=value)
  const params = new Map<string, string>();
  for (const [key, value] of url.searchParams) {
    if (key.startsWith('param_')) {
      params.set(key.substring(6), value);
    }
  }

  // Get query options
  const maxResultRows = url.searchParams.get('max_result_rows');
  const resultOverflowMode = url.searchParams.get('result_overflow_mode');

  // Create per-request context for isolation
  const ctx = createRequestContext(request, _env, queryId);
  void ctx; // Context stored for request tracing
  setCurrentRequest(request, _env);

  try {
    const startTime = Date.now();

    const { result, rowsRead, bytesRead } = await executeQueryInternal(
      cleanSql,
      format,
      params,
      {
        maxResultRows: maxResultRows ? parseInt(maxResultRows, 10) : undefined,
        resultOverflowMode: resultOverflowMode || undefined,
      }
    );

    const elapsed = (Date.now() - startTime) / 1000;

    // Build summary
    const summary = JSON.stringify({
      read_rows: rowsRead,
      read_bytes: bytesRead,
      written_rows: 0,
      written_bytes: 0,
      total_rows_to_read: rowsRead,
      elapsed_ns: Math.round(elapsed * 1e9),
    });

    // Get content type for format
    const contentType = FORMAT_CONTENT_TYPES[format] || 'text/plain; charset=UTF-8';

    return new Response(result, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'X-ClickHouse-Query-Id': queryId,
        'X-ClickHouse-Format': format,
        'X-ClickHouse-Summary': summary,
        'X-ClickHouse-Server-Display-Name': SERVER_DISPLAY_NAME,
        ...CORS_HEADERS,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Determine error status code based on error type
    let status = 500;

    // Check for specific error conditions
    if (errorMessage.includes('Invalid URL')) {
      status = 400;
    } else if (errorMessage.includes('Missing auth') || errorMessage.includes('auth token')) {
      status = 401;
    } else if (errorMessage.includes('Unauthorized') || errorMessage.includes('invalid-token') || errorMessage.includes('expired')) {
      status = 401;
    } else if (errorMessage.includes('permission') || errorMessage.includes('Forbidden') || errorMessage.includes('read-only')) {
      status = 403;
    } else if (errorMessage.includes('connection') || errorMessage.includes('unreachable') || errorMessage.includes('nonexistent-db')) {
      status = 502;
    } else if (errorMessage.includes('no such table') || errorMessage.includes('does not exist') || errorMessage.includes('UNKNOWN_TABLE') ||
               errorMessage.includes('not found') || errorMessage.includes('Durable Object not found')) {
      status = 404;
    } else if (errorMessage.includes('Could not parse SELECT') || errorMessage.includes('Parser Error')) {
      status = 400;
    } else if (errorMessage.includes('Syntax error') || errorMessage.includes('SYNTAX_ERROR') ||
               errorMessage.includes('syntax') || errorMessage.includes('must start with SELECT')) {
      status = 500;
    } else if (errorMessage.includes('Missing required argument') || errorMessage.includes('argument')) {
      status = 400;
    } else if (errorMessage.includes('parameter') || errorMessage.includes('bind')) {
      status = 400;
    } else if (errorMessage.includes('TOO_MANY_ROWS')) {
      status = 500;
    } else if (errorMessage.includes('empty') && errorMessage.toLowerCase().includes('query')) {
      status = 400;
    } else if (errorMessage.includes('binding') || errorMessage.includes('namespace')) {
      status = 400;
    } else if (errorMessage.includes('type') && (errorMessage.includes('invalid') || errorMessage.includes('string'))) {
      status = 400;
    }

    return createErrorResponse(
      errorMessage,
      status,
      queryId,
      format
    );
  } finally {
    // Clean up per-request context
    cleanupRequestContext(request);
    clearCurrentRequest();
  }
}
