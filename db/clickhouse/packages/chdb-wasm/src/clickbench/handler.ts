/**
 * ClickBench HTTP Request Handler
 *
 * Handles HTTP requests for the /clickbench endpoint, providing access to
 * ClickBench benchmark functionality via the MergeTree WASM module.
 *
 * Endpoints:
 *   GET /clickbench            - Info about the benchmark
 *   GET /clickbench/schema     - Table schema information
 *   GET /clickbench/queries    - List all 43 queries
 *   GET /clickbench/queries/:id - Get a specific query
 *   GET /clickbench/run/:id    - Run a specific query (0-42)
 *   GET /clickbench/run/all    - Run all queries with timing
 *   POST /clickbench/query     - Run custom SQL query
 *   GET /clickbench/stats      - Query statistics
 *
 * @module clickbench/handler
 */

import type { R2Bucket } from '../storage/r2-provider';
import type { SqlExecutor } from '../http-query-handler';
import { MergeTreeLoader } from '../wasm/mergetree-loader';
import { InMemoryStorageProvider, type VFSStorageProvider } from '../wasm/vfs-bridge';
import { ClickBenchExecutor, type QueryResult, type PartInfo as _PartInfo } from './executor';
import {
  CLICKBENCH_QUERIES,
  QUERY_COUNT,
  getQueryById,
  getQueryStatistics,
  type ClickBenchQuery as _ClickBenchQuery,
} from './queries';
import {
  HITS_TABLE_METADATA,
  HITS_COLUMNS,
  generateCreateTableStatement,
} from './schema';

// ============================================================================
// Types
// ============================================================================

/**
 * Cloudflare Fetcher interface
 */
interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

/**
 * Cloudflare Durable Object Namespace interface
 */
interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  idFromString(hexId: string): DurableObjectId;
  newUniqueId(): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

interface DurableObjectId {
  toString(): string;
}

interface DurableObjectStub {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

/**
 * Environment bindings for ClickBench handler
 */
export interface ClickBenchRequestEnv {
  ASSETS: Fetcher;
  DATA_BUCKET?: R2Bucket;
  MERGETREE_DO?: DurableObjectNamespace;
}

/**
 * Benchmark result for a single query
 */
interface BenchmarkResult {
  queryId: number;
  queryName: string;
  sql: string;
  success: boolean;
  elapsedMs: number;
  rows: number;
  error?: string;
}

/**
 * Full benchmark run result
 */
interface FullBenchmarkResult {
  results: BenchmarkResult[];
  totalQueries: number;
  successfulQueries: number;
  failedQueries: number;
  totalElapsedMs: number;
  averageElapsedMs: number;
}

// ============================================================================
// CORS and Response Helpers
// ============================================================================

/**
 * CORS headers for API responses
 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/**
 * Create a JSON response
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

// ============================================================================
// Global State
// ============================================================================

let _cachedLoader: MergeTreeLoader | null = null;
void _cachedLoader; // Intentionally unused - reserved for future loader caching
let cachedExecutor: ClickBenchExecutor | null = null;
let loaderInitPromise: Promise<void> | null = null;

// Global SQL executor for real WASM execution
let globalSqlExecutor: SqlExecutor | null = null;

/**
 * Set the SQL executor for real WASM execution in ClickBench queries.
 * When set, queries will be delegated to the real ClickHouse WASM engine
 * instead of using mock data.
 */
export function setClickBenchSqlExecutor(executor: SqlExecutor | null): void {
  globalSqlExecutor = executor;
  // Update existing executor if already initialized
  if (cachedExecutor) {
    cachedExecutor.setSqlExecutor(executor);
  }
}

// ============================================================================
// Main Handler
// ============================================================================

/**
 * Handle ClickBench API requests
 */
export async function handleClickBenchRequest(
  request: Request,
  env: ClickBenchRequestEnv
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }

  try {
    // Route requests
    if (path === '/clickbench' || path === '/clickbench/') {
      return handleInfo();
    }

    if (path === '/clickbench/schema') {
      return handleSchema();
    }

    if (path === '/clickbench/queries') {
      return handleListQueries();
    }

    if (path.match(/^\/clickbench\/queries\/\d+$/)) {
      const id = parseInt(path.split('/').pop()!, 10);
      return handleGetQuery(id);
    }

    if (path === '/clickbench/run/all') {
      return await handleRunAll(env);
    }

    if (path.match(/^\/clickbench\/run\/\d+$/)) {
      const id = parseInt(path.split('/').pop()!, 10);
      return await handleRunQuery(env, id);
    }

    if (path === '/clickbench/query' && request.method === 'POST') {
      return await handleCustomQuery(request, env);
    }

    if (path === '/clickbench/stats') {
      return handleStats();
    }

    // Unknown endpoint
    return errorResponse(`Not found: ${path}`, 404);
  } catch (error) {
    console.error('ClickBench handler error:', error);
    return errorResponse(
      error instanceof Error ? error.message : String(error),
      500
    );
  }
}

// ============================================================================
// Route Handlers
// ============================================================================

/**
 * GET /clickbench - API info
 */
function handleInfo(): Response {
  return jsonResponse({
    name: 'ClickBench API',
    description: 'Execute ClickBench queries against MergeTree WASM',
    version: '1.0.0',
    table: HITS_TABLE_METADATA.name,
    columnCount: HITS_TABLE_METADATA.columnCount,
    queryCount: QUERY_COUNT,
    approximateRowCount: HITS_TABLE_METADATA.approximateRowCount,
    endpoints: [
      'GET /clickbench - This info',
      'GET /clickbench/schema - Table schema information',
      'GET /clickbench/queries - List all 43 queries',
      'GET /clickbench/queries/:id - Get a specific query (0-42)',
      'GET /clickbench/run/:id - Run a specific query',
      'GET /clickbench/run/all - Run all queries with timing',
      'POST /clickbench/query - Run custom SQL query',
      'GET /clickbench/stats - Query statistics',
    ],
  });
}

/**
 * GET /clickbench/schema - Table schema
 */
function handleSchema(): Response {
  return jsonResponse({
    table: HITS_TABLE_METADATA.name,
    database: HITS_TABLE_METADATA.database,
    engine: HITS_TABLE_METADATA.engine,
    orderBy: HITS_TABLE_METADATA.orderBy,
    primaryKey: HITS_TABLE_METADATA.primaryKey,
    columnCount: HITS_TABLE_METADATA.columnCount,
    approximateRowCount: HITS_TABLE_METADATA.approximateRowCount,
    columns: HITS_COLUMNS.map(col => ({
      name: col.name,
      type: col.type,
      index: col.index,
      description: col.description,
    })),
    createStatement: generateCreateTableStatement(),
  });
}

/**
 * GET /clickbench/queries - List all queries
 */
function handleListQueries(): Response {
  const queries = CLICKBENCH_QUERIES.map(q => ({
    id: q.id,
    name: q.name,
    category: q.category,
    complexity: q.complexity,
    description: q.description,
    sql: q.sql,
  }));

  return jsonResponse({
    total: QUERY_COUNT,
    queries,
  });
}

/**
 * GET /clickbench/queries/:id - Get specific query
 */
function handleGetQuery(id: number): Response {
  const query = getQueryById(id);
  if (!query) {
    return errorResponse(`Query not found: ${id}`, 404);
  }

  return jsonResponse({
    id: query.id,
    name: query.name,
    sql: query.sql,
    category: query.category,
    complexity: query.complexity,
    description: query.description,
    columns: query.columns,
    hasAggregation: query.hasAggregation,
    hasGroupBy: query.hasGroupBy,
    hasOrderBy: query.hasOrderBy,
    hasWhere: query.hasWhere,
    hasLimit: query.hasLimit,
  });
}

/**
 * GET /clickbench/run/:id - Run specific query
 */
async function handleRunQuery(
  env: ClickBenchRequestEnv,
  id: number
): Promise<Response> {
  const query = getQueryById(id);
  if (!query) {
    return errorResponse(`Query not found: ${id}`, 404);
  }

  const executor = await getExecutor(env);
  const result = await executor.execute(query.sql);

  return jsonResponse({
    queryId: query.id,
    queryName: query.name,
    ...formatQueryResult(result),
  });
}

/**
 * GET /clickbench/run/all - Run all queries
 */
async function handleRunAll(env: ClickBenchRequestEnv): Promise<Response> {
  const executor = await getExecutor(env);
  const results: BenchmarkResult[] = [];
  const startTime = performance.now();

  for (const query of CLICKBENCH_QUERIES) {
    try {
      const result = await executor.execute(query.sql);
      results.push({
        queryId: query.id,
        queryName: query.name,
        sql: query.sql,
        success: true,
        elapsedMs: result.elapsedMs,
        rows: result.rows,
      });
    } catch (error) {
      results.push({
        queryId: query.id,
        queryName: query.name,
        sql: query.sql,
        success: false,
        elapsedMs: 0,
        rows: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const totalElapsedMs = performance.now() - startTime;
  const successfulQueries = results.filter(r => r.success).length;
  const failedQueries = results.filter(r => !r.success).length;

  const response: FullBenchmarkResult = {
    results,
    totalQueries: QUERY_COUNT,
    successfulQueries,
    failedQueries,
    totalElapsedMs,
    averageElapsedMs: totalElapsedMs / QUERY_COUNT,
  };

  return jsonResponse(response);
}

/**
 * POST /clickbench/query - Run custom query
 */
async function handleCustomQuery(
  request: Request,
  env: ClickBenchRequestEnv
): Promise<Response> {
  let sql: string;

  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const body = await request.json() as { query?: string };
    sql = body.query || '';
  } else {
    sql = await request.text();
  }

  if (!sql.trim()) {
    return errorResponse('Missing query', 400);
  }

  const executor = await getExecutor(env);
  const result = await executor.execute(sql);

  return jsonResponse(formatQueryResult(result));
}

/**
 * GET /clickbench/stats - Query statistics
 */
function handleStats(): Response {
  return jsonResponse(getQueryStatistics());
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Format query result for JSON response
 */
function formatQueryResult(result: QueryResult): Record<string, unknown> {
  return {
    data: result.data,
    meta: result.meta,
    rows: result.rows,
    rowsBeforeLimit: result.rowsBeforeLimit,
    elapsedMs: result.elapsedMs,
    query: result.query,
    warnings: result.warnings,
  };
}

/**
 * Get or create executor
 */
async function getExecutor(env: ClickBenchRequestEnv): Promise<ClickBenchExecutor> {
  if (cachedExecutor) {
    return cachedExecutor;
  }

  // Wait for ongoing initialization
  if (loaderInitPromise) {
    await loaderInitPromise;
    if (cachedExecutor) {
      return cachedExecutor;
    }
  }

  // Initialize
  loaderInitPromise = initExecutor(env);
  await loaderInitPromise;

  if (!cachedExecutor) {
    throw new Error('Failed to initialize ClickBench executor');
  }

  return cachedExecutor;
}

/**
 * Initialize the executor
 */
async function initExecutor(env: ClickBenchRequestEnv): Promise<void> {
  // Create storage provider
  const storage: VFSStorageProvider = new InMemoryStorageProvider();

  // Create loader - cast ASSETS to avoid Fetcher type mismatch (our local Fetcher
  // doesn't include 'connect' method which Cloudflare Workers runtime provides)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const loader = new MergeTreeLoader(env.ASSETS as any, '/wasm/mergetree.wasm');

  try {
    // Try to load WASM binary
    const wasmResponse = await env.ASSETS.fetch(
      new Request('https://placeholder/wasm/mergetree.wasm')
    );

    if (wasmResponse.ok) {
      const wasmBinary = await wasmResponse.arrayBuffer();
      await loader.init(storage, wasmBinary);
    } else {
      throw new Error('MergeTree WASM not available. Ensure WASM binary is deployed.');
    }
  } catch (error) {
    throw new Error(`Failed to load MergeTree WASM: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Create executor with optional SQL executor for real WASM execution
  cachedExecutor = new ClickBenchExecutor(loader, storage, {
    sqlExecutor: globalSqlExecutor ?? undefined,
    useRealExecutorOnly: true, // Always use real executor, propagate errors
  });
  _cachedLoader = loader;

  // Register initial part for the hits table
  // In production, this discovers actual parts from R2/DO storage
  cachedExecutor.registerPart({
    database: 'default',
    table: 'hits',
    partition: 'all',
    partName: 'all_0_0_0',
    rowCount: 1000,
  });
}

// ============================================================================
// ClickBench-Compatible JSON Output
// ============================================================================

/**
 * Generate ClickBench-compatible JSON output for benchmark results
 * This format is used for submitting results to the ClickBench website
 */
export function generateClickBenchJSON(results: BenchmarkResult[]): Record<string, unknown> {
  const times: (number | null)[][] = results.map(r => {
    if (r.success) {
      // ClickBench expects 3 runs per query - we provide 1 and null for others
      return [r.elapsedMs / 1000, null, null];
    }
    return [null, null, null];
  });

  return {
    system: 'chdb-wasm',
    date: new Date().toISOString().split('T')[0],
    machine: 'cloudflare-worker',
    cluster_size: 1,
    comment: 'MergeTree WASM in Cloudflare Workers',
    tags: ['wasm', 'cloudflare', 'mergetree'],
    load_time: 0,
    data_size: HITS_TABLE_METADATA.approximateCompressedSize,
    result: times,
  };
}
